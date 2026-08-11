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
  // Set by /api/generate when the request carried the owner's test-mode
  // key (see lib/testMode.ts + app/admin/test-mode) — the worker forces
  // skipSearch on regardless of lodging-cache state, since the web_search
  // round-trip is the single biggest latency/cost source per generation
  // (see generateItinerary in worker/src/index.ts). Not a cost-free
  // generation (it's still a real, smaller Claude call) — just the
  // cheapest and fastest real path, for the site owner's own testing.
  testMode?: boolean;
}

export const JOBS_QUEUE_KEY = "jobs:queue";
// 30 days — a finished job is also the payload behind a shareable /trip/[id]
// link (see app/trip/[jobId]), so this needs to outlive a single polling
// session by a lot, not just cover the few minutes generation takes.
export const JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

// ~1 year — applied to a job's TTL the moment it's curated into the
// showcase gallery or set as the homepage demo (see the admin routes for
// both), on top of the normal JOB_TTL_SECONDS every job starts with. A
// curated trip is a deliberate, ongoing editorial choice, not a transient
// generation — it shouldn't silently rot on the same 30-day clock as every
// other job and vanish from a page someone is actively pointing visitors
// at, with no warning. Not literally forever, so a truly abandoned/
// forgotten entry still eventually frees its Redis space rather than
// staying forever.
export const CURATED_JOB_TTL_SECONDS = 60 * 60 * 24 * 365;

export function jobKey(id: string): string {
  return `job:${id}`;
}
