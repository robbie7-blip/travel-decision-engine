"use client";

import { useState, type KeyboardEvent } from "react";
import type { Dictionary } from "@/lib/i18n";
import { MAX_TRIP_QA_MESSAGE_LENGTH, type TripQAContext, type TripQAMessage } from "@/lib/tripQA";
import type { Language } from "@/lib/types";

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

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    if (content.length > MAX_TRIP_QA_MESSAGE_LENGTH) {
      setError(t.tripQA.tooLong);
      return;
    }

    const next: TripQAMessage[] = [...messages, { role: "user", content }];
    const assistantIndex = next.length;
    setMessages([...next, { role: "assistant", content: "" }]);
    setDraft("");
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
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
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
          disabled={sending || !draft.trim()}
          className="font-mono btn-primary"
          style={{
            padding: "10px 16px",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: sending || !draft.trim() ? "default" : "pointer",
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
