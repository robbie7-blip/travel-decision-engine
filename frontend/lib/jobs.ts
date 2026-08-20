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
  // key (see lib/testMode.ts + app/admin/test-mode). Bypasses the
  // GUARDRAILS — daily spend cap, rate limits, monthly quota — and nothing
  // else.
  //
  // It used to also force the degraded no-search path, which conflated two
  // unrelated things and got the important one backwards: the owner, the
  // one person who needs to see exactly what a traveler sees, was the only
  // one being served a weaker itinerary. A test that doesn't reproduce the
  // real product can't answer questions about the real product — which is
  // precisely what it kept being used for. Test-mode generations are now
  // identical in output to a real one; they simply aren't blocked by limits
  // meant for the public.
  testMode?: boolean;
  // Stage timings in ms, written by the worker on every job. Generation
  // latency has now been diagnosed three times by reasoning about which
  // stage *should* dominate, and been wrong. This puts the actual numbers
  // on the job record itself, where they travel with the result and can be
  // read without shell access to the worker — see the diagnostics line on
  // the trip page (admin-only).
  timings?: JobTimings;
  // What the acceptance gate found on the finished itinerary — see
  // worker/src/engine/quality.ts. Written on every completed generation,
  // whether it passed or not.
  //
  // This is deliberately part of the job record rather than a log line.
  // The reason quality problems kept surviving deploys is that the only
  // detector was the owner opening a trip and noticing something wrong,
  // which meant every quality question cost a paid generation to ask.
  // Carrying the verdict with the result makes it a field, and makes real
  // traveler traffic the regression signal.
  quality?: QualityReport;
}

export type QualitySeverity = "defect" | "warning";

export type QualityCheckId =
  | "meals_present"
  | "no_duplicate_venues"
  | "venues_named"
  | "lodging_per_night"
  | "lodging_named"
  | "day_not_empty"
  | "day_has_gap"
  | "prices_present"
  | "lodging_price_per_night"
  | "price_matches_tier"
  | "transport_legs"
  | "open_on_visit"
  | "must_see_covered"
  | "budget_matches_items"
  | "grounded_ratio";

export interface QualityFinding {
  check: QualityCheckId;
  severity: QualitySeverity;
  detail: string;
  day?: number;
}

export interface QualityReport {
  findings: QualityFinding[];
  defectCount: number;
  warningCount: number;
  groundedPercent: number;
  itemCount: number;
  /** No "defect"-severity finding survived. Not a claim the itinerary is
   * good — a claim it isn't visibly broken. */
  passed: boolean;
}

export interface JobTimings {
  totalMs: number;
  /** Live lodging/property lookups, in parallel, before generation. */
  lodgingPrefetchMs?: number;
  /** Whole generation stage — the sum of the two phases below, plus any
   * fallback. */
  generateMs?: number;
  /** Phase 1 — the trip frame and the day plan, which run concurrently, so
   * this is the slower of the two rather than their sum. */
  skeletonMs?: number;
  /** Phase 2 — wall time for all day calls together, not their sum. */
  daysMs?: number;
  dayCount?: number;
  /** How many waves the day calls took. Anything above 1 means
   * MAX_PARALLEL_DAYS is below this trip's length and phase 2 paid for its
   * slowest day more than once — the exact regression that made a 10-day
   * trip take twice as long as it needed to while the stage timing looked
   * merely "slow". */
  dayWaves?: number;
  /** True when phase 2 had to wait for the trip frame as well as the day
   * plan. The day calls only need the plan, so normally the frame runs
   * alongside them and costs nothing — this is only set when the live
   * lodging lookup came back short and the frame's own price estimate was
   * the only figure available, which puts the slower half of phase 1 back
   * on the critical path. A run showing true is a run where fixing lodging
   * would also make generation faster. */
  waitedForFrame?: boolean;
  /** Duplicate-venue and missing-meal repairs, which share one stage. */
  repairsMs?: number;
  /** Google Places verification + Amadeus, which run concurrently with each
   * other. Runs BEFORE the repairs now — see processJob for why. */
  venuesAndFlightsMs?: number;
  /** The second Places pass, over only the venues the repairs replaced or
   * added. Near-zero on a clean generation, since it's skipped entirely
   * when nothing was repaired. */
  verifyRepairsMs?: number;
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
