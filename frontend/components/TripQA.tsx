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

/** General trip Q&A — packing, safety, local customs — kept deliberately
 * separate from the pushback/refine box on ItineraryResult, which is for
 * revising the itinerary itself. This never touches the itinerary; it's
 * just a short conversation, held in local state only (nothing persisted
 * server-side, consistent with this being a lightweight companion feature
 * rather than a second product surface). */
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
    setMessages(next);
    setDraft("");
    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/trip-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context, language }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : t.tripQA.genericError);
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
    } catch (e) {
      // The user's own message stays visible (not rolled back) — they can
      // just hit send again once the error's addressed, rather than
      // retyping what they already asked.
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
          {messages.map((m, i) => (
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
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="font-mono" style={{ alignSelf: "flex-start", fontSize: 12, color: "var(--ink-dim)" }}>
              {t.tripQA.thinking}
            </div>
          )}
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
      <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>
        {t.tripQA.disclaimer}
      </div>
    </div>
  );
}
