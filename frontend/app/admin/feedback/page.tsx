// Password-protected (see middleware.ts) internal view of the feedback
// entries submitted via /api/feedback. Reads directly from Redis — no
// separate API route, since this is the only consumer.

import { getRedis } from "@/lib/redis";
import { FEEDBACK_LIST_KEY, type FeedbackEntry } from "@/lib/feedback";

export const dynamic = "force-dynamic"; // always fresh, never statically cached
export const runtime = "nodejs";

async function loadFeedback(): Promise<FeedbackEntry[]> {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return [];
  }

  const raw = await redis.lrange<string | FeedbackEntry>(FEEDBACK_LIST_KEY, 0, -1);
  // Upstash's client auto-deserializes JSON-looking strings, so entries may
  // already be objects rather than strings depending on how they were set.
  const entries = raw.map((r) => (typeof r === "string" ? (JSON.parse(r) as FeedbackEntry) : r));
  return entries.reverse(); // newest first
}

export default async function FeedbackAdminPage() {
  const entries = await loadFeedback();
  const wrongCount = entries.filter((e) => e.rating === "wrong").length;

  return (
    <div
      className="font-mono"
      style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto", color: "var(--ink)" }}
    >
      <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
        Feedback
      </h1>
      <div style={{ color: "var(--ink-dim)", fontSize: 13, marginBottom: 24 }}>
        {entries.length} total · {wrongCount} flagged wrong
      </div>

      {entries.length === 0 && <p style={{ color: "var(--ink-dim)" }}>No feedback yet.</p>}

      {entries.map((e) => (
        <div
          key={e.id}
          style={{
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "14px 16px",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
            <strong style={{ color: e.rating === "wrong" ? "var(--infeasible)" : "var(--grounded)" }}>
              {e.rating.toUpperCase()}
            </strong>{" "}
            · {new Date(e.createdAt).toLocaleString()} · job {e.jobId} · day {e.day}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {e.item.title}{" "}
            <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}>
              ({e.item.type}, €{e.item.cost_estimate_eur}, {e.item.confidence_tier ?? e.item.source_confidence})
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            {e.item.location} · {e.item.time}
          </div>
          <div style={{ fontSize: 13, marginTop: 6, color: "#c8c5b8" }}>{e.item.reasoning}</div>
          {e.comment && (
            <div style={{ fontSize: 13, marginTop: 8, fontStyle: "italic", color: "var(--unverified)" }}>
              &ldquo;{e.comment}&rdquo;
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
