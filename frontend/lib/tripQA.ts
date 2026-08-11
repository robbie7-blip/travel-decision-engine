// Shared types for the trip-Q&A feature (see app/api/trip-questions,
// components/TripQA.tsx) — general practical trip questions (packing,
// safety, local customs) answered directly by Claude, deliberately separate
// from the itinerary engine: no schema to fill, no web_search, so it can be
// a quick synchronous request/response instead of the job-queue flow
// generation needs (see the comment at the top of the API route for why).

export type TripQARole = "user" | "assistant";

/** A photo attached to a question — "is this minibar complimentary", "what
 * does this sign say", "is this dish vegetarian". Deliberately carried
 * inline as base64 and NEVER persisted anywhere: it goes to the model with
 * the request and is gone. These photos are of hotel rooms, menus,
 * receipts and documents, so "we don't keep it" is both the honest answer
 * and a far better privacy position than any retention window would be. */
export interface TripQAImage {
  mediaType: TripQAImageMediaType;
  /** Raw base64, with no `data:` URL prefix. */
  data: string;
}

export const TRIP_QA_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type TripQAImageMediaType = (typeof TRIP_QA_IMAGE_MEDIA_TYPES)[number];

export interface TripQAMessage {
  role: TripQARole;
  content: string;
  images?: TripQAImage[];
}

/** One photo per question. The use case is "what is this thing in front of
 * me", which is singular by nature — and a single image keeps the cost and
 * the UI honest. */
export const MAX_TRIP_QA_IMAGES_PER_MESSAGE = 1;

/** Across the whole conversation, only this many of the most recent images
 * are actually sent. Without a cap, a long photo thread re-uploads every
 * earlier photo on every turn, and image tokens dominate the request
 * quietly. Two is enough for the common follow-up ("and the one next to
 * it?") while bounding the worst case. */
export const MAX_TRIP_QA_IMAGES_SENT = 2;

/** Longest edge, in px, the client resizes to before upload. Chosen for
 * LEGIBILITY rather than the smallest possible payload: the whole point is
 * reading small print on a minibar card or a menu, and over-shrinking is
 * what would actually break the feature. */
export const TRIP_QA_IMAGE_MAX_EDGE_PX = 1568;

/** Hard ceiling on a single decoded image, after the client's own resize.
 * This is a backstop against a hand-crafted request, not something a real
 * photo from the UI should ever approach. */
export const MAX_TRIP_QA_IMAGE_BYTES = 2 * 1024 * 1024;

// Optional trip context to ground answers — every field is optional since
// this feature works two ways: embedded on a generated itinerary's result
// page (full context available), and standalone on /ask for someone who
// hasn't generated anything here at all (no context at all, or whatever
// they mention in the question itself).
export interface TripQAContext {
  destinations?: string[];
  start_date?: string;
  end_date?: string;
  party_composition?: string;
  interests?: string[];
}

// A single message beyond this length is almost certainly not a genuine
// quick trip question — bounds worst-case token cost per request.
export const MAX_TRIP_QA_MESSAGE_LENGTH = 800;

// The client keeps the full visible conversation, but only this many most
// recent messages are actually sent to the model on each turn — bounds
// cost/latency on a long-running chat without capping how long the visible
// conversation can get.
export const MAX_TRIP_QA_HISTORY = 20;
