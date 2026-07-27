// Shared feedback envelope + Redis key convention for the trust-feedback
// loop: lets a user flag whether a specific itinerary line item held up
// after their trip. Stored durably (no TTL, unlike jobs.ts's
// JOB_TTL_SECONDS) since the whole point is accumulating a correction
// dataset over time. Frontend-only — the worker never reads or writes this.

import type { ItineraryItem } from "./types";

export type FeedbackRating = "helpful" | "wrong";

export interface FeedbackEntry {
  id: string;
  jobId: string;
  createdAt: number;
  day: number;
  // A snapshot of the rated item, not just a reference — job records expire
  // after JOB_TTL_SECONDS (1 hour), so anything worth reviewing later has to
  // be self-contained.
  item: ItineraryItem;
  rating: FeedbackRating;
  comment?: string;
}

export const FEEDBACK_LIST_KEY = "feedback:all";
export const MAX_COMMENT_LENGTH = 500;
