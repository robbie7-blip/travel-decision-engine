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
  // Stage timings in ms, written by the worker on every job. Generation
  // latency has now been diagnosed three times by reasoning about which
  // stage *should* dominate, and been wrong. This puts the actual numbers
  // on the job record itself, where they travel with the result and can be
  // read without shell access to the worker — see the diagnostics line on
  // the trip page (admin-only).
  timings?: JobTimings;
}

export interface JobTimings {
  totalMs: number;
  /** Live lodging/property lookups, in parallel, before generation. */
  lodgingPrefetchMs?: number;
  /** Whole generation stage — the sum of the two phases below, plus any
   * fallback. */
  generateMs?: number;
  /** Phase 1 of two-phase generation. */
  skeletonMs?: number;
  /** Phase 2 — wall time for all day calls together, not their sum. */
  daysMs?: number;
  dayCount?: number;
  /** Google Places + Amadeus, which run concurrently with each other. */
  venuesAndFlightsMs?: number;
  /** True when two-phase generation failed and the entire itinerary was
   * regenerated through the original single-call path — the single most
   * expensive thing that can happen to a job, and previously invisible
   * from outside the worker's stderr. */
  fellBackToSingleCall?: boolean;
  /** Why it fell back, when it did. */
  fallbackReason?: string;
}

export const JOBS_QUEUE_KEY = "jobs:queue";
// 30 days — a finished job is also the payload behind a shareable /trip/[id]
// link (see app/trip/[jobId]), so this needs to outlive a single polling
// session by a lot, not just cover the few minutes generation takes.
export const JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

export function jobKey(id: string): string {
  return `job:${id}`;
}
