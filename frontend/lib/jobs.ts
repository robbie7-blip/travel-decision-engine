// Shared job envelope + Redis key conventions for the async generation
// pipeline. Imported by both the Next.js app (writes jobs via the Upstash
// REST client, reads status for polling) and the worker (consumes jobs via
// a standard TCP Redis client, writes results). Deliberately has no
// Next.js-specific imports so it's portable to the worker like the rest of
// lib/engine/.

import type { Itinerary, TripBriefInput } from "./types";

export type JobStatus = "pending" | "running" | "done" | "error";

// Present when this job is a pushback/follow-up on a previously generated
// itinerary rather than a fresh generation — see buildRefinementPrompt.
// baseItinerary is the client's current (possibly already-revised) view of
// the itinerary; carrying it in the request avoids depending on the
// original job still being present under JOB_TTL_SECONDS.
export interface RefinementRequest {
  question: string;
  baseItinerary: Itinerary;
}

export interface Job {
  id: string;
  status: JobStatus;
  brief: TripBriefInput;
  refinement?: RefinementRequest;
  result?: Itinerary;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export const JOBS_QUEUE_KEY = "jobs:queue";
// 30 days — a finished job is also the payload behind a shareable /trip/[id]
// link (see app/trip/[jobId]), so this needs to outlive a single polling
// session by a lot, not just cover the few minutes generation takes.
export const JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

export function jobKey(id: string): string {
  return `job:${id}`;
}
