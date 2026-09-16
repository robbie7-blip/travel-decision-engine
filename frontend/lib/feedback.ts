// Shared feedback envelope + Redis key convention for the trust-feedback
// loop: lets a user flag whether a specific itinerary line item held up
// after their trip. Stored durably (no TTL, unlike jobs.ts's
// JOB_TTL_SECONDS) since the whole point is accumulating a correction
// dataset over time. Frontend-only - the worker never reads or writes this.

import type { ItineraryItem } from "./types";

export type FeedbackRating = "helpful" | "wrong";

export interface FeedbackEntry {
  id: string;
  jobId: string;
  createdAt: number;
  day: number;
  // A snapshot of the rated item, not just a reference - job records expire
  // after JOB_TTL_SECONDS (1 hour), so anything worth reviewing later has to
  // be self-contained.
  item: ItineraryItem;
  rating: FeedbackRating;
  comment?: string;
}

export const FEEDBACK_LIST_KEY = "feedback:all";
export const MAX_COMMENT_LENGTH = 500;

const RATINGS = new Set<string>(["helpful", "wrong"]);

/** One stored entry, or null.
 *
 * /admin/feedback read the list as `raw.map((r) => typeof r === "string" ?
 * JSON.parse(r) as FeedbackEntry : r)` and then rendered
 * `e.rating.toUpperCase()` and `e.item.title` - an unguarded parse inside a
 * map, and two unguarded dereferences on fields nothing had checked. So one
 * unreadable entry took the whole page down, and this list has NO TTL by
 * design ("stored durably, since the whole point is accumulating a
 * correction dataset over time"), which means a bad entry is permanent and
 * the page that would show you it is the page that breaks.
 *
 * `item` is filled in rather than required: the entry's own value is the
 * rating and the comment, and losing a whole piece of feedback because the
 * snapshot beside it is malformed loses the data this list exists to keep.
 * An empty title renders as an empty title, which is visibly odd and
 * reviewable - which is the point of the page. */
export function readFeedbackEntry(value: unknown): FeedbackEntry | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const e = parsed as Record<string, unknown>;
  if (typeof e.rating !== "string" || !RATINGS.has(e.rating)) return null;
  const item = typeof e.item === "object" && e.item !== null ? (e.item as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id: str(e.id),
    jobId: str(e.jobId),
    createdAt: num(e.createdAt),
    day: num(e.day),
    item: {
      ...(item as unknown as ItineraryItem),
      time: str(item.time),
      type: (["transport", "lodging", "activity", "meal"] as string[]).includes(str(item.type))
        ? (item.type as ItineraryItem["type"])
        : "activity",
      title: str(item.title),
      location: str(item.location),
      reasoning: str(item.reasoning),
      source_confidence: str(item.source_confidence) === "grounded" ? "grounded" : "inferred",
    },
    rating: e.rating as FeedbackRating,
    ...(typeof e.comment === "string" ? { comment: e.comment } : {}),
  };
}

/** Every readable entry, in stored order. */
export function readFeedbackList(raw: readonly unknown[]): FeedbackEntry[] {
  return raw.map(readFeedbackEntry).filter((e): e is FeedbackEntry => e !== null);
}
