"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { linkifyAnswer } from "@/lib/linkify";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import {
  MAX_TRIP_QA_IMAGE_BYTES,
  MAX_TRIP_QA_MESSAGE_LENGTH,
  TRIP_QA_IMAGE_MAX_EDGE_PX,
  LOCAL_VOICES,
  type LocalVoice,
  type TripQAContext,
  type TripQAImage,
  type TripQAMessage,
} from "@/lib/tripQA";
import type { Language } from "@/lib/types";
import { VOICE_AVATARS } from "./LocalVoiceAvatar";
import { ThinkingMark } from "./ThinkingMark";

/** The trip's start month, in the reading language, for the starter
 * questions. Returns "" on a missing or unparseable date, which leaves the
 * packing question reading "...for Rome in?" - so the caller only reaches
 * for it when a date is present. */
function monthName(date: string | undefined, language: Language): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(language === "bg" ? "bg-BG" : "en-GB", {
      month: "long",
      timeZone: "UTC",
    }).format(parsed);
  } catch {
    return "";
  }
}

/** Downscales a picked photo to TRIP_QA_IMAGE_MAX_EDGE_PX on its long edge
 * and re-encodes it as JPEG, in the browser, before anything is uploaded.
 * Three things this has to get right:
 *
 * - EXIF orientation. A phone photo is very often stored rotated with an
 *   orientation flag, and drawing it to a canvas without honouring that
 *   flag uploads a sideways picture - which for this feature means asking
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
  // here - the model falls back to whatever the traveler mentions in their
  // question, or asks a brief clarifying question if it genuinely can't
  // answer without it (see the system prompt in the API route).
  context?: TripQAContext;
  language: Language;
  t: Dictionary;
}

/** General trip Q&A ("Ask a Local") - packing, safety, local customs - kept
 * deliberately separate from the pushback/refine box on ItineraryResult,
 * which is for revising the itinerary itself. This never touches the
 * itinerary; it's just a short conversation, held in local state only
 * (nothing persisted server-side, consistent with this being a lightweight
 * companion feature rather than a second product surface).
 *
 * Reads the API route's response as a plain text stream, appending each
 * chunk directly into the growing assistant message - the reply appears
 * word by word as it's generated, the same feel as ChatGPT/Gemini, rather
 * than a blank wait followed by the whole answer at once. */
export function TripQA({ context, language, t }: TripQAProps) {
  const [messages, setMessages] = useState<TripQAMessage[]>([]);
  // null is "Anyone", the plain assistant this feature had before. It is
  // the default on purpose: a picker that forces a choice before the first
  // question turns a text box into a form.
  const [voice, setVoice] = useState<LocalVoice | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pendingImage, setPendingImage] = useState<TripQAImage | null>(null);
  // null until the account check resolves - the photo button stays visible
  // throughout, so the control never pops into existence after load.
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [showProUpsell, setShowProUpsell] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Whether the full character picker is showing.
   *
   * Shut by default, and that is the point: five cards, a greeting and a
   * disclaimer were the first thing on the page and the ask box was the
   * last. Most people never change this, so it collapses to one line
   * naming who is answering, one tap from the full set. */
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  /** Which answer was just copied, so the button can say so. Cleared on a
   * timer, and by index rather than a boolean so copying one answer does
   * not light up the button on every other one. */
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  /** Whether the traveler is reading the newest message rather than
   * scrolled back through the thread. */
  const stuckToBottom = useRef(true);

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
    // A photo on its own is a valid question - only require text when
    // there's no image attached.
    if ((!content && !pendingImage) || sending) return;
    if (content.length > MAX_TRIP_QA_MESSAGE_LENGTH) {
      setError(t.tripQA.tooLong);
      return;
    }

    // Asking something new means following along again. Whatever they had
    // scrolled back to re-read, the answer they now want is the one about
    // to arrive at the bottom.
    stuckToBottom.current = true;

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
        body: JSON.stringify({ messages: next, context, language, voice }),
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
      // bubble - the error below is the only thing shown for this turn.
      setMessages((prev) => prev.filter((_, i) => i !== assistantIndex));
      setError(e instanceof Error ? e.message : t.tripQA.genericError);
    } finally {
      setSending(false);
    }
  }

  // Keep the newest words in view as the answer streams in.
  //
  // The thread is a fixed-height scroll box and nothing ever scrolled it,
  // so any answer taller than the box grew downwards out of sight: you
  // asked a question, the reply arrived, and to read it you had to find
  // and drag an inner scrollbar. On a phone that is the difference between
  // a conversation and a puzzle.
  //
  // Sticks to the bottom rather than always jumping there. If they have
  // scrolled up to re-read something, yanking the view back down every
  // time another chunk lands is worse than the bug being fixed - so this
  // only follows along while they are already at the end.
  useEffect(() => {
    const el = threadRef.current;
    if (!el || !stuckToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** The last assistant message, but only once it has finished arriving -
   * empty while streaming, so the announcement happens on completion
   * rather than on every chunk. */
  const lastMessage = messages[messages.length - 1];
  const finishedAnswer =
    !sending && lastMessage?.role === "assistant" ? lastMessage.content : "";

  function handleThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    // A line of slack, so "at the bottom" survives sub-pixel rounding and
    // a part-rendered final line.
    stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  /** Copies a finished answer.
   *
   * navigator.clipboard is not available on an insecure origin and can be
   * refused even on a secure one, so the failure path says nothing rather
   * than claiming a copy that did not happen - a button that lies about
   * having copied something is worse than one that does nothing visible. */
  async function copyAnswer(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1600);
    } catch {
      // Deliberately silent. There is nothing the traveler can do about
      // it, and an error banner over a convenience is noise.
    }
  }

  /** Grows the box to fit what has been typed, up to the max-height in
   * .trip-qa-input, after which it scrolls itself.
   *
   * Height is reset to "auto" first because scrollHeight never shrinks
   * below the height already set: without the reset the box grows as you
   * type and then stays tall after you delete it all, or after sending. */
  function resizeInput() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    // An EMPTY box stays one row, and this early return is the whole
    // reason it does. scrollHeight on an empty textarea counts the
    // placeholder's wrapped height, not the value's - measured at 112px
    // for a one-row box at phone width, because the placeholder takes
    // four lines there. Sizing to it grew the composer to fit text nobody
    // had typed, and since the buttons sit at the bottom of the box, they
    // ended up an inch below the first line of the placeholder.
    if (el.value === "") return;
    el.style.height = `${el.scrollHeight}px`;
  }

  // After every change to the draft, including the ones this component
  // makes itself: clearing it on send, and filling it from a starter
  // question. A handler on the textarea alone would miss both.
  useEffect(resizeInput, [draft]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // send() owns its own error state; void marks the rejection as
      // deliberately unobserved rather than leaving it unhandled.
      void send();
    }
  }

  // NOT a hook, despite what the old name (`useExample`) implied. It is a
  // plain click handler that fills the draft box, and the `use` prefix
  // made react-hooks/rules-of-hooks report it as a hook called inside a
  // callback - a false positive on the one rule that protects this file
  // from real hook misuse.
  function applyExample(prompt: string) {
    if (sending) return;
    setDraft(prompt);
  }

  // On a trip page the starter questions name the trip's own city and
  // month; on /ask, where there is no trip, they stay the generic set.
  // Falls back to generic if the brief somehow has no destination, so an
  // odd job record produces plain questions rather than "{destination}".
  const examples = (() => {
    const destination = context?.destinations?.[0]?.trim();
    if (!destination) return t.tripQA.examplePrompts;
    const month = monthName(context?.start_date, language);
    return t.tripQA.examplePromptsForTrip
      // Without a usable date the packing question would read "...in ?",
      // so drop it rather than ship a sentence with a hole in it.
      .filter((p) => month || !p.includes("{month}"))
      .map((p) => p.replace(/\{destination\}/g, destination).replace(/\{month\}/g, month));
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Mid-conversation: who you are talking to stays visible, and can
          still be changed - clearing the thread, because a character
          switching mid-exchange would otherwise be answering for lines
          somebody else said. */}
      {messages.length > 0 && voice && (
        <div className="voice-strip font-ui">
          {(() => {
            const Avatar = VOICE_AVATARS[voice];
            return <Avatar size={26} />;
          })()}
          <span style={{ color: "var(--ink-dim)" }}>{t.tripQA.voiceAsking}</span>
          <span style={{ fontWeight: 600 }}>{t.tripQA.voices[voice].label}</span>
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setVoice(null);
            }}
            className="voice-strip-change"
          >
            {t.tripQA.voiceChange}
          </button>
        </div>
      )}
      {/* The single announcement Ask a Local makes to a screen reader: the
          finished answer, once.
          
          The thread itself must NOT be a live region. appendToAssistant
          fires setMessages per streamed chunk, so a live region wrapping
          the thread reads the reply out in dozens of partial fragments and
          reads the traveler's own question back to them first. A live
          region also has to exist BEFORE the text changes to announce it,
          which is why this is always rendered rather than toggled on when
          the answer completes. */}
      <span className="sr-only" aria-live="polite">
        {finishedAnswer}
      </span>
      {messages.length > 0 && (
        <div ref={threadRef} onScroll={handleThreadScroll} className="qa-thread">
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            // The assistant's message starts empty and fills in as chunks
            // arrive - show a brief pulse instead of a blank space until
            // the first word lands.
            const isPendingAssistant = m.role === "assistant" && m.content === "" && sending && isLast;
            const isStreaming = m.role === "assistant" && sending && isLast;

            // The traveler's own turn: a bubble, because it IS a message.
            // Short, theirs, and findable again by shape alone when the
            // thread has scrolled.
            if (m.role === "user") {
              return (
                <div key={i} className="qa-turn qa-turn-user">
                  <div className="qa-bubble qa-bubble-user">
                    {m.images?.map((img, imgIndex) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={imgIndex}
                        src={`data:${img.mediaType};base64,${img.data}`}
                        alt={t.tripQA.photoAlt}
                        style={{
                          display: "block",
                          maxWidth: "100%",
                          borderRadius: 10,
                          marginBottom: m.content ? 8 : 0,
                        }}
                      />
                    ))}
                    {/* The traveler's own words, verbatim. Linkifying these
                        would apply the MODEL's conventions to a human's
                        typing: "what does [[this]] mean on my ticket?" would
                        lose its brackets and turn into a map search, and a
                        booking URL they pasted would be relabelled so the
                        message no longer shows what they sent. */}
                    {m.content}
                  </div>
                </div>
              );
            }

            // The character's face beside their own answers, so a thread
            // with four possible speakers still reads as a conversation
            // with one of them.
            const Avatar = voice ? VOICE_AVATARS[voice] : null;
            return (
              <div key={i} className="qa-turn">
                {Avatar && (
                  <span className="voice-bubble-avatar">
                    <Avatar size={28} />
                  </span>
                )}
                <div className="qa-answer">
                  {isPendingAssistant ? (
                    /* The answer streams in token by token once it starts,
                       so this covers the gap before the first one - which
                       was a grey word and nothing else. */
                    <span className="font-ui thinking-row" style={{ color: "var(--ink-dim)" }}>
                      <ThinkingMark size={20} />
                      <span>{t.tripQA.thinking}</span>
                    </span>
                  ) : (
                    // Segments, never innerHTML - see lib/linkify.ts. A place
                    // the local names becomes a Maps search for it; a source
                    // it cites becomes the page. Both are built here from a
                    // validated URL rather than taken from the model.
                    linkifyAnswer(m.content, {
                      near: context?.destinations?.[0]?.trim(),
                      // The last message is still arriving while sending, so
                      // a URL at the very end of it may be half-delivered.
                      streaming: isStreaming,
                    }).map((seg, segIndex) =>
                      seg.kind === "text" ? (
                        seg.text
                      ) : (
                        <a
                          key={segIndex}
                          href={seg.href}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="qa-link"
                        >
                          {seg.text}
                        </a>
                      )
                    )
                  )}
                  {/* Where the next word will appear, rather than a spinner
                      somewhere else on the page. aria-hidden because a
                      screen reader is told about the finished answer once,
                      by the live region above. */}
                  {isStreaming && m.content !== "" && <span className="qa-caret" aria-hidden />}
                  {!isStreaming && m.content !== "" && (
                    <div className="qa-actions">
                      <button
                        type="button"
                        onClick={() => void copyAnswer(i, m.content)}
                        className="font-ui qa-action"
                        aria-label={t.tripQA.copyAnswer}
                      >
                        {copiedIndex === i ? t.tripQA.copied : t.tripQA.copyAnswer}
                      </button>
                    </div>
                  )}
                </div>
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
            className="font-ui"
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
          className="font-ui"
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
      {/* One box, not three controls in a row. See .qa-composer. */}
      <div className="qa-composer">
        {/* capture="environment" makes this open the rear camera directly on
            a phone, which is the actual moment this feature is for - standing
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
          // The control for the one moment this feature is for: standing
          // in front of the thing you are asking about.
          className="font-ui qa-photo"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--ink-soft)",
            borderRadius: 999,
            width: 36,
            height: 36,
            padding: 0,
            cursor: sending ? "default" : "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden style={{ width: 22, height: 22 }}>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8.5h3.2l1.4-2h7.8l1.4 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
            />
            <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.tripQA.placeholder}
          // A placeholder is not a label: it is the only thing naming this
          // box, and it disappears the moment you start typing. This box is
          // the whole feature, so with a screen reader it announced as an
          // unnamed edit field.
          //
          // Its own string now, rather than the placeholder reused. The
          // placeholder has to fit one line in a 163px box on a phone, and
          // a label does not have to fit anything - so the short invitation
          // is what you see and the full sentence is what is announced.
          aria-label={t.tripQA.inputLabel}
          // One row to start. It grows to fit what is typed (resizeInput),
          // so the box is the size of the question rather than the size of
          // the longest question anyone might ask.
          rows={1}
          // A class, not inline styles, because the size of this box has to
          // change with the viewport. It was 13px, which is under the 16px
          // iOS Safari demands before it will let you type without zooming
          // the whole page in. See .trip-qa-input.
          className="font-ui trip-qa-input"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || (!draft.trim() && !pendingImage)}
          className="font-ui qa-send"
          // The label is on the button rather than in it: the arrow says
          // "send" to anyone looking, and says nothing at all to a screen
          // reader.
          aria-label={sending ? t.tripQA.sending : t.tripQA.send}
          title={sending ? t.tripQA.sending : t.tripQA.send}
        >
          {sending ? (
            // Three dots rather than a spinner, because the answer is
            // already streaming in above and a spinner would suggest
            // nothing is happening yet.
            <svg viewBox="0 0 24 24" aria-hidden style={{ width: 18, height: 18 }}>
              <circle cx="6" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="18" cy="12" r="1.6" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden style={{ width: 18, height: 18 }}>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 19V5M5 12l7-7 7 7"
              />
            </svg>
          )}
        </button>
      </div>
      {error && (
        <div className="font-ui" style={{ fontSize: 12, color: "var(--infeasible)" }}>
          {error}
        </div>
      )}
      {/* BELOW the composer, both of them, and that ordering is the whole
          point of this layout.

          The ask box is the feature. It was last on the page and the
          smallest thing on it: a heading, five character cards, a
          disclaimer and four starter pills all came first, so the one
          control someone came here to use ranked bottom. Position is
          the strongest emphasis there is, and it was pointing at the
          scenery.

          Nothing is conditional about the order. With an empty thread
          the composer is simply the first thing rendered; once the
          conversation starts the thread appears above it and it sits
          at the bottom where a composer belongs. */}
      {messages.length === 0 && examples.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {examples.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => applyExample(prompt)}
              // qa-example is only a touch-target hook: these pills were
              // 266x29 on a phone, and .hover-card is shared with the full
              // city cards, which must not be given a 44px floor they do
              // not need.
              className="font-ui hover-card qa-example"
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
      {/* Who you're asking. Only before the first question: mid
          conversation a full picker would compete with the input, and
          swapping character halfway through reads as the person you were
          talking to being replaced. Once the thread starts, the chosen
          character shrinks to the strip below instead. */}
      {messages.length === 0 && (
        <div>
          {/* One line instead of a heading and five cards. It says who is
              answering and opens the full set, which is all the default
              state of this control needs to do. */}
          <button
            type="button"
            onClick={() => setVoicePickerOpen((open) => !open)}
            aria-expanded={voicePickerOpen}
            className="font-ui qa-voice-summary"
          >
            {voice ? (
              (() => {
                const Avatar = VOICE_AVATARS[voice];
                return <Avatar size={22} />;
              })()
            ) : (
              <span className="qa-voice-summary-any" aria-hidden>
                ?
              </span>
            )}
            <span style={{ color: "var(--ink-dim)" }}>{t.tripQA.voiceAsking}</span>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>
              {voice ? t.tripQA.voices[voice].label : t.tripQA.voiceAnyone}
            </span>
            <span className="qa-voice-summary-change">{t.tripQA.voiceChange}</span>
          </button>
          {voicePickerOpen && (
            <>
              <div className="voice-grid" style={{ marginTop: 10 }}>
            {([null, ...LOCAL_VOICES] as (LocalVoice | null)[]).map((option) => {
              const active = voice === option;
              const Avatar = option ? VOICE_AVATARS[option] : null;
              return (
                <button
                  key={option ?? "any"}
                  type="button"
                  onClick={() => setVoice(option)}
                  aria-pressed={active}
                  className="font-ui voice-card"
                  data-active={active}
                >
                  {Avatar ? (
                    <Avatar size={40} inverted={active} />
                  ) : (
                    <span className="voice-card-any" aria-hidden>
                      ?
                    </span>
                  )}
                  <span className="voice-card-text">
                    <span className="voice-card-name">
                      {option ? t.tripQA.voices[option].label : t.tripQA.voiceAnyone}
                    </span>
                    <span className="voice-card-blurb">
                      {option ? t.tripQA.voices[option].blurb : t.tripQA.voiceAnyoneBlurb}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* The character says hello in their own voice. A local string,
              not a model call, so trying all four costs nothing and the
              greeting never enters the conversation history that gets sent
              back to the model. */}
          {voice && (
            <div className="voice-greeting">
              {(() => {
                const Avatar = VOICE_AVATARS[voice];
                return <Avatar size={34} />;
              })()}
              <span>{t.tripQA.voices[voice].greeting}</span>
            </div>
          )}

          {/* Says plainly that this is a point of view, not a person. The
              prompt refuses to invent a biography; this is the same
              promise made where the traveler can see it. Inside the
              expanded picker, because it is about the characters and
              there is no reason to say it to someone who never opened
              them. */}
          <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 10 }}>
            {t.tripQA.voiceNote}
          </div>
          </>
          )}
        </div>
      )}

    </div>
  );
}
