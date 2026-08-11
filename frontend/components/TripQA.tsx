"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import {
  MAX_TRIP_QA_IMAGE_BYTES,
  MAX_TRIP_QA_MESSAGE_LENGTH,
  TRIP_QA_IMAGE_MAX_EDGE_PX,
  type TripQAContext,
  type TripQAImage,
  type TripQAMessage,
} from "@/lib/tripQA";
import type { Language } from "@/lib/types";

/** Downscales a picked photo to TRIP_QA_IMAGE_MAX_EDGE_PX on its long edge
 * and re-encodes it as JPEG, in the browser, before anything is uploaded.
 * Three things this has to get right:
 *
 * - EXIF orientation. A phone photo is very often stored rotated with an
 *   orientation flag, and drawing it to a canvas without honouring that
 *   flag uploads a sideways picture — which for this feature means asking
 *   the model to read sideways small print.
 * - Quality over size. Encoded at 0.9 because the entire use case is
 *   reading fine print on a minibar card or a menu; JPEG artifacts land
 *   hardest on exactly that kind of small text.
 * - Never uploading the original. A modern phone photo is several MB and
 *   far more resolution than the model uses anyway. */
async function fileToResizedImage(file: File): Promise<TripQAImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
    // Safari lagged on the options argument; retry bare rather than failing
    // outright, accepting possible rotation over no photo at all.
    createImageBitmap(file)
  );

  const scale = Math.min(1, TRIP_QA_IMAGE_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { mediaType: "image/jpeg", data };
}

interface TripQAProps {
  // Omitted (or partially filled) on /ask when no trip has been generated
  // here — the model falls back to whatever the traveler mentions in their
  // question, or asks a brief clarifying question if it genuinely can't
  // answer without it (see the system prompt in the API route).
  context?: TripQAContext;
  language: Language;
  t: Dictionary;
}

/** General trip Q&A ("Ask a Local") — packing, safety, local customs — kept
 * deliberately separate from the pushback/refine box on ItineraryResult,
 * which is for revising the itinerary itself. This never touches the
 * itinerary; it's just a short conversation, held in local state only
 * (nothing persisted server-side, consistent with this being a lightweight
 * companion feature rather than a second product surface).
 *
 * Reads the API route's response as a plain text stream, appending each
 * chunk directly into the growing assistant message — the reply appears
 * word by word as it's generated, the same feel as ChatGPT/Gemini, rather
 * than a blank wait followed by the whole answer at once. */
export function TripQA({ context, language, t }: TripQAProps) {
  const [messages, setMessages] = useState<TripQAMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pendingImage, setPendingImage] = useState<TripQAImage | null>(null);
  // null until the account check resolves — the photo button stays visible
  // throughout, so the control never pops into existence after load.
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [showProUpsell, setShowProUpsell] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setIsPro(d?.plan === "paid");
      })
      .catch(() => {
        if (!cancelled) setIsPro(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onPhotoButtonClick() {
    if (sending) return;
    // Tell a free traveler up front rather than letting them pick a photo,
    // type a question and only then hit a 403 from the route.
    if (isPro === false) {
      setShowProUpsell(true);
      return;
    }
    fileInputRef.current?.click();
  }

  async function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice in a row still fires
    // a change event.
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      const image = await fileToResizedImage(file);
      if (Math.floor((image.data.length * 3) / 4) > MAX_TRIP_QA_IMAGE_BYTES) {
        setError(t.tripQA.photoTooLarge);
        return;
      }
      setPendingImage(image);
    } catch {
      setError(t.tripQA.photoUnreadable);
    }
  }

  async function send() {
    const content = draft.trim();
    // A photo on its own is a valid question — only require text when
    // there's no image attached.
    if ((!content && !pendingImage) || sending) return;
    if (content.length > MAX_TRIP_QA_MESSAGE_LENGTH) {
      setError(t.tripQA.tooLong);
      return;
    }

    const next: TripQAMessage[] = [
      ...messages,
      { role: "user", content, ...(pendingImage ? { images: [pendingImage] } : {}) },
    ];
    const assistantIndex = next.length;
    setMessages([...next, { role: "assistant", content: "" }]);
    setDraft("");
    setPendingImage(null);
    setSending(true);
    setError("");

    function appendToAssistant(chunk: string) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = { ...updated[assistantIndex], content: updated[assistantIndex].content + chunk };
        return updated;
      });
    }

    try {
      const res = await fetch("/api/trip-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context, language }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.detail === "string" ? data.detail : t.tripQA.genericError);
      }
      if (!res.body) {
        throw new Error(t.tripQA.genericError);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appendToAssistant(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      // Drop the empty assistant placeholder rather than leaving a blank
      // bubble — the error below is the only thing shown for this turn.
      setMessages((prev) => prev.filter((_, i) => i !== assistantIndex));
      setError(e instanceof Error ? e.message : t.tripQA.genericError);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function useExample(prompt: string) {
    if (sending) return;
    setDraft(prompt);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.length === 0 && t.tripQA.examplePrompts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {t.tripQA.examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => useExample(prompt)}
              className="font-mono hover-card"
              style={{
                border: "1px solid var(--line)",
                background: "var(--bg-panel-raised)",
                color: "var(--ink-soft)",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
      {messages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
          {messages.map((m, i) => {
            // The assistant's message starts empty and fills in as chunks
            // arrive — show a brief pulse instead of a blank bubble until
            // the first word lands.
            const isPendingAssistant = m.role === "assistant" && m.content === "" && sending && i === messages.length - 1;
            return (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: m.role === "user" ? "var(--accent-green)" : "var(--bg-panel-raised)",
                  color: m.role === "user" ? "var(--bg-panel)" : "var(--ink)",
                  border: m.role === "user" ? "none" : "1px solid var(--line)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.images?.map((img, imgIndex) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={imgIndex}
                    src={`data:${img.mediaType};base64,${img.data}`}
                    alt={t.tripQA.photoAlt}
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      borderRadius: 6,
                      marginBottom: m.content ? 8 : 0,
                    }}
                  />
                ))}
                {isPendingAssistant ? (
                  <span className="font-mono" style={{ color: "var(--ink-dim)" }}>
                    {t.tripQA.thinking}
                  </span>
                ) : (
                  m.content
                )}
              </div>
            );
          })}
        </div>
      )}
      {pendingImage && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${pendingImage.mediaType};base64,${pendingImage.data}`}
            alt={t.tripQA.photoAlt}
            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }}
          />
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            className="font-mono"
            style={{
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink-soft)",
              borderRadius: 999,
              padding: "5px 12px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {t.tripQA.removePhoto}
          </button>
        </div>
      )}
      {showProUpsell && (
        <div
          className="font-mono"
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--ink-soft)",
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{t.tripQA.photoProOnly}</span>
          <Link href="/pricing" style={{ color: "var(--accent-green)", fontWeight: 700 }}>
            {t.tripQA.photoProOnlyCta} →
          </Link>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        {/* capture="environment" makes this open the rear camera directly on
            a phone, which is the actual moment this feature is for — standing
            in front of the thing you're asking about. Desktop browsers ignore
            it and show a normal file picker. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFilePicked}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={onPhotoButtonClick}
          disabled={sending}
          aria-label={t.tripQA.addPhoto}
          title={t.tripQA.addPhoto}
          className="font-mono"
          style={{
            border: "1px solid var(--line)",
            background: "var(--bg-panel)",
            color: "var(--ink-soft)",
            borderRadius: 8,
            padding: "10px 12px",
            cursor: sending ? "default" : "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden style={{ width: 17, height: 17 }}>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8.5h3.2l1.4-2h7.8l1.4 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
            />
            <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.tripQA.placeholder}
          rows={2}
          className="font-mono"
          style={{
            flex: 1,
            resize: "vertical",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--bg-panel)",
            color: "var(--ink)",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || (!draft.trim() && !pendingImage)}
          className="font-mono btn-primary"
          style={{
            padding: "10px 16px",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: sending || (!draft.trim() && !pendingImage) ? "default" : "pointer",
            flexShrink: 0,
          }}
        >
          {sending ? t.tripQA.sending : t.tripQA.send}
        </button>
      </div>
      {error && (
        <div className="font-mono" style={{ fontSize: 12, color: "var(--infeasible)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
