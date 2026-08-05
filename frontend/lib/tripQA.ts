// Shared types for the trip-Q&A feature (see app/api/trip-questions,
// components/TripQA.tsx) — general practical trip questions (packing,
// safety, local customs) answered directly by Claude, deliberately separate
// from the itinerary engine: no schema to fill, no web_search, so it can be
// a quick synchronous request/response instead of the job-queue flow
// generation needs (see the comment at the top of the API route for why).

export type TripQARole = "user" | "assistant";

export interface TripQAMessage {
  role: TripQARole;
  content: string;
}

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
