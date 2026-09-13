// Shared job envelope + Redis key conventions for the async generation
// pipeline. Imported by both the Next.js app (writes jobs via the Upstash
// REST client, reads status for polling) and the worker (consumes jobs via
// a standard TCP Redis client, writes results). Deliberately has no
// Next.js-specific imports so it's portable to the worker like the rest of
// lib/engine/.

import type { Itinerary, TripBriefInput } from "./types";

export type JobStatus = "pending" | "running" | "done" | "error";

// Present when this job is a pushback/follow-up on a previously generated
// itinerary rather than a fresh generation - see buildRefinementPrompt.
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
  // GUARDRAILS - daily spend cap, rate limits, monthly quota - and nothing
  // else.
  //
  // It used to also force the degraded no-search path, which conflated two
  // unrelated things and got the important one backwards: the owner, the
  // one person who needs to see exactly what a traveler sees, was the only
  // one being served a weaker itinerary. A test that doesn't reproduce the
  // real product can't answer questions about the real product - which is
  // precisely what it kept being used for. Test-mode generations are now
  // identical in output to a real one; they simply aren't blocked by limits
  // meant for the public.
  testMode?: boolean;
  // Stage timings in ms, written by the worker on every job. Generation
  // latency has now been diagnosed three times by reasoning about which
  // stage *should* dominate, and been wrong. This puts the actual numbers
  // on the job record itself, where they travel with the result and can be
  // read without shell access to the worker - see the diagnostics line on
  // the trip page (admin-only).
  timings?: JobTimings;
  // What the acceptance gate found on the finished itinerary - see
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
  /** What exists so far, written while the job is still running.
   *
   * The wait is the longest visual moment in the product - the better part
   * of a minute - and it was a spinner. It is also the moment the traveler
   * is most engaged, because they just asked for this and are waiting to
   * see it. The generator already knows the trip's shape long before the
   * days are written: phase 1 produces the plan (dates, cities, a theme per
   * day) at roughly the halfway mark, and each day lands separately after
   * that. This carries both to the page as they happen.
   *
   * Deliberately NOT written into `result`. A half-finished itinerary that
   * looked like a finished one would be saved to recent trips, shared,
   * exported to a calendar and read as final. This is a separate field the
   * trip page only renders while status is "running", and the finished
   * itinerary replaces it wholesale. */
  progress?: JobProgress;
}

export interface ProgressDay {
  day: number;
  date: string;
  city: string;
  /** The plan's one-line intent for the day. Present from phase 1, which
   * is what makes the outline worth showing before any day is written. */
  theme: string;
  /** Fills in when this day's own model call returns. */
  itemCount?: number;
  titles?: string[];
}

export interface JobProgress {
  /** Set once phase 1 lands, so the page can stop guessing how many days
   * there will be. */
  days: ProgressDay[];
  updatedAt: number;
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
  | "time_to_visit"
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
   * good - a claim it isn't visibly broken. */
  passed: boolean;
}

export interface JobTimings {
  totalMs: number;
  /** Live lodging/property lookups, in parallel, before generation. */
  lodgingPrefetchMs?: number;
  /** Whole generation stage - the sum of the two phases below, plus any
   * fallback. */
  generateMs?: number;
  /** Phase 1 - the trip frame and the day plan, which run concurrently, so
   * this is the slower of the two rather than their sum. */
  skeletonMs?: number;
  /** The two halves of phase 1, timed separately, and the wait for the live
   * accommodation lookup.
   *
   * skeletonMs is the MAX of all three, which is the right answer to "when
   * could phase 2 start" and useless for "what should I fix". On the first
   * measured 58.5s generation it read 29.2s - identical to the
   * accommodation lookup - and there was no way to tell from outside
   * whether the frame had landed at 12s or at 29s, which is the difference
   * between the bounded wait saving fourteen seconds and saving two.
   *
   * Latency in this pipeline has now been diagnosed by reasoning four times
   * and been wrong three of them. These are the numbers that stop the fifth
   * time being a guess. */
  planMs?: number;
  frameMs?: number;
  /** Replacements the repair stage named that Places then could not
   * confirm, so they were stripped to generic.
   *
   * The acceptance gate reports these with the same words it uses for an
   * item the model never named at all - "names no specific venue" - and the
   * two have opposite fixes: one is a prompt problem, the other is a
   * venue-matching problem. On the 102.4s Rome run, "Breakfast at Antico
   * Caffe Sant'Eustachio" and "Lunch at Pizzarium Bonci" both read that
   * way, with no Places outage anywhere in the log, and nothing said which
   * had happened. */
  repairsStripped?: number;
  /** Silent retries, per stage, that each cost a whole extra model call.
   *
   * A malformed or unusable response is retried once (see withOneRetryOf),
   * and that retry used to happen in complete silence - no log, nothing on
   * the job. On the 102.4s generation phase 1 read "plan 68.8s, frame
   * 31.6s": the plan is the half every comment calls the FAST one, and
   * 68.8s is almost exactly twice a single call. A retried plan was the
   * obvious explanation and there was no way to confirm it.
   *
   * It matters more since isUsablePlan was tightened to require `city` and
   * `include_lodging` on every day. That gate is right - a missing
   * include_lodging shipped a multi-night trip with no accommodation - but
   * it costs a full extra plan call whenever the model omits one field. A
   * doubled stage should say so rather than be inferred from arithmetic. */
  retries?: Record<string, number>;
  /** True when phase 2 stopped waiting for the live accommodation lookup
   * and used the frame's estimate instead - see LODGING_GRACE_MS. Distinct
   * from lodgingShort, which means the lookup ANSWERED and came back empty;
   * this means it had not answered yet and was no longer worth waiting
   * for. */
  accommodationWaitAbandoned?: boolean;
  /** Phase 2 - wall time for all day calls together, not their sum. */
  daysMs?: number;
  dayCount?: number;
  /** How many waves the day calls took. Anything above 1 means
   * MAX_PARALLEL_DAYS is below this trip's length and phase 2 paid for its
   * slowest day more than once - the exact regression that made a 10-day
   * trip take twice as long as it needed to while the stage timing looked
   * merely "slow". */
  dayWaves?: number;
  /** True when phase 2 had to wait for the trip frame as well as the day
   * plan. The day calls only need the plan, so normally the frame runs
   * alongside them and costs nothing - this is only set when the live
   * lodging lookup came back short and the frame's own price estimate was
   * the only figure available, which puts the slower half of phase 1 back
   * on the critical path. A run showing true is a run where fixing lodging
   * would also make generation faster. */
  waitedForFrame?: boolean;
  /** Which half of the lodging lookup came back empty, per city, after its
   * retry. Empty when every lookup answered in full.
   *
   * waitedForFrame says the frame was on the critical path; this says why,
   * and the two failures behind it are not the same size. A missing
   * property costs a named hotel. A missing rate costs the frame wait -
   * about twenty seconds on the run this was added for. Without the
   * distinction the only way to tell them apart was to pay for another
   * generation and read the worker's stderr. */
  lodgingShort?: { city: string; missing: "rate" | "property" }[];
  /** Duplicate-venue and missing-meal repairs, which share one stage. */
  repairsMs?: number;
  /** Google Places verification + Amadeus, which run concurrently with each
   * other. Runs BEFORE the repairs now - see processJob for why. */
  venuesAndFlightsMs?: number;
  /** The second Places pass, over only the venues the repairs replaced or
   * added. Near-zero on a clean generation, since it's skipped entirely
   * when nothing was repaired. */
  verifyRepairsMs?: number;
  /** True when two-phase generation failed and the entire itinerary was
   * regenerated through the original single-call path - the single most
   * expensive thing that can happen to a job, and previously invisible
   * from outside the worker's stderr. */
  fellBackToSingleCall?: boolean;
  /** Why it fell back, when it did. */
  fallbackReason?: string;
  /** The reasoning effort each stage actually ran at.
   *
   * Recorded because effort stopped being one global setting. The frame,
   * the plan and the day calls now default to different levels, and each is
   * separately overridable from the hosting dashboard with no deploy -
   * which means a stage timing on this job can no longer be read without
   * knowing which configuration produced it.
   *
   * That distinction has already cost real money once. A generation went
   * from 58.5s to 102.4s with several changes in flight and no record of
   * which settings were live, so the regression could be argued about but
   * not attributed, and settling it needed another paid run. A run that
   * carries its own configuration is a run that can be compared to the
   * next one. */
  efforts?: { frame: string; plan: string; day: string };
}

export const JOBS_QUEUE_KEY = "jobs:queue";
// 30 days - a finished job is also the payload behind a shareable /trip/[id]
// link (see app/trip/[jobId]), so this needs to outlive a single polling
// session by a lot, not just cover the few minutes generation takes.
export const JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

// --- FRONTEND-ONLY (not mirrored to the worker) ---
// Only the app's admin routes curate a trip, so this constant has no reason
// to exist in the worker's copy. Declared rather than merely tolerated: see
// scripts/checkMirrors.mjs, which strips sentinel blocks before comparing
// and fails on every other difference.
//
// ~1 year - applied to a job's TTL the moment it's curated into the
// showcase gallery or set as the homepage demo (see the admin routes for
// both), on top of the normal JOB_TTL_SECONDS every job starts with. A
// curated trip is a deliberate, ongoing editorial choice, not a transient
// generation - it shouldn't silently rot on the same 30-day clock as every
// other job and vanish from a page someone is actively pointing visitors
// at, with no warning. Not literally forever, so a truly abandoned/
// forgotten entry still eventually frees its Redis space rather than
// staying forever.
export const CURATED_JOB_TTL_SECONDS = 60 * 60 * 24 * 365;

// --- END FRONTEND-ONLY ---
/** After this long with no update, a "running" job is treated as dead.
 *
 * BRPOP removes a job from the queue the moment a worker takes it, and
 * nothing puts it back. So a worker that restarts mid-job - which happens on
 * every deploy and every environment-variable change - leaves a record stuck
 * at "running" that no one will ever finish. The page then spins for the
 * full polling timeout and fails with a generic message, which is the worst
 * possible version of this: the traveler waits the longest and learns the
 * least.
 *
 * Generous enough that a slow generation is never mistaken for a dead one -
 * the longest real run measured is comfortably under two minutes - and short
 * enough to say something useful well before the poll gives up. */
export const STALE_RUNNING_MS = 4 * 60 * 1000;

/** After this long still queued, nothing is consuming the queue.
 *
 * This is the other half of the problem STALE_RUNNING_MS covers, and it was
 * missed the first time. That constant catches a worker that died PART WAY
 * THROUGH a job. It cannot catch a worker that was never there to take the
 * job at all, because a job nobody picked up never leaves "pending", and
 * isStalledJob only ever looked at "running".
 *
 * Which is not a hypothetical: the worker is paused whenever the hosting
 * plan lapses, and a queue with no consumer looks exactly like a very slow
 * generation from the page - the traveler waits out the full poll and is
 * told nothing useful, which is the precise failure the running-job check
 * was written to end.
 *
 * Much shorter than STALE_RUNNING_MS because the signal is unambiguous. A
 * live worker sits blocked in BRPOP and takes a job within milliseconds of
 * it being pushed, so "still pending" is never a sign of a slow trip the
 * way "still running" legitimately can be. 90s is far past any normal
 * pickup and still well inside the poll. */
export const STALE_PENDING_MS = 90 * 1000;

export type StallReason = "worker_restarted" | "worker_offline";

/** Why this job is never going to finish, or null if it still might.
 *
 * The two cases need different words in front of the traveler: one is "your
 * generation was interrupted, try again" and the other is "the planner is
 * down, this is on us". Collapsing them into one boolean would mean telling
 * someone to retry into a queue that nothing is reading. */
export function stallReason(job: Job): StallReason | null {
  // A record with no usable timestamp is the case this whole function
  // exists for, and it was the one case that slipped through.
  //
  // `Date.now() - undefined` is NaN, and every comparison against NaN is
  // false - so a job stuck at "running" with a missing, NaN, Infinity or
  // string updatedAt returned null here forever. Not "not stalled yet":
  // never stalled, at any age. The traveller then polls for the full
  // MAX_WAIT_MS (five minutes, see lib/api.ts) and is told "this is taking
  // much longer than expected", which is the exact five-minute spinner
  // STALE_RUNNING_MS was written to end, defeated by one absent field.
  //
  // Measured, not supposed: for updatedAt of undefined, NaN, "2026-09-13"
  // and Infinity this returned null on a job that had been running for ten
  // minutes. (`null` did stall - it coerces to 0 - which is the tell that
  // the guard was accidental rather than designed.)
  //
  // Treated as stalled rather than ignored, because that is what it is:
  // the worker writes updatedAt every time it touches a job, so a record
  // without one is not a generation in progress. Saying "interrupted, try
  // again" is right, and it is certainly better than a spinner that never
  // resolves into anything.
  if (!Number.isFinite(job.updatedAt)) {
    return job.status === "pending" ? "worker_offline" : job.status === "running" ? "worker_restarted" : null;
  }
  const age = Date.now() - job.updatedAt;
  if (job.status === "running" && age > STALE_RUNNING_MS) return "worker_restarted";
  if (job.status === "pending" && age > STALE_PENDING_MS) return "worker_offline";
  return null;
}

/** True when a job claims to be running but hasn't been touched since
 * STALE_RUNNING_MS ago. The worker writes the record when it picks a job up
 * and again when it finishes, so a gap this long means nothing is holding
 * it. */
export function isStalledJob(job: Job): boolean {
  return stallReason(job) !== null;
}

export function jobKey(id: string): string {
  return `job:${id}`;
}

const JOB_STATUSES = new Set<string>(["pending", "running", "done", "error"]);

/** True when what came out of Redis is actually a job envelope.
 *
 * Same reasoning as isWorkerHeartbeat in lib/health.ts, and the same
 * evidence behind it: every reader here did `JSON.parse(raw) as Job` or
 * `raw as Job`, asserting a shape over a stored value that outlives the
 * deploy that wrote it. Three readers, three different bad outcomes from
 * the same record:
 *
 *   - GET /api/job/[id] parses outside any try, so a non-JSON value is an
 *     unhandled throw on an endpoint the trip page polls every 400ms;
 *   - a value that parses but is not a job (a number, an array, a record
 *     missing `status`) returns 200 with nothing the client recognises, so
 *     pollJob loops for the full five minutes - and stallReason cannot
 *     rescue it, because a record like that has no usable updatedAt either;
 *   - the worker's processJob parses it too, inside a catch that logs and
 *     moves on, so the job is dropped without ever being marked failed.
 *
 * `brief` is checked as an object but not validated field by field - the
 * worker re-reads it and parseTripBrief already owns that - and the
 * optional fields are left alone. This is the envelope, not the contents. */
export function isJob(value: unknown): value is Job {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const job = value as Partial<Job>;
  return (
    typeof job.id === "string" &&
    job.id.length > 0 &&
    typeof job.status === "string" &&
    JOB_STATUSES.has(job.status) &&
    typeof job.brief === "object" &&
    job.brief !== null &&
    Number.isFinite(job.createdAt) &&
    Number.isFinite(job.updatedAt)
  );
}

/** Reads a job record as it comes back from either Redis client, or null.
 *
 * The Upstash REST client auto-deserializes JSON-looking strings while
 * ioredis always hands back a string, so both shapes reach the readers and
 * every one of them open-coded the same ternary. Doing it once means the
 * parse is inside a try exactly once, too. */
export function readJobRecord(raw: unknown): Job | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isJob(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Worker heartbeat
//
// The frontend cannot see the worker. They are two separate deployments on
// two separate hosts with two separate sets of environment variables, and
// nothing has ever crossed that gap except jobs on the queue. Both of the
// real incidents this product has had were the same shape: a credential was
// missing on one side, the other side had no way to know, and the symptom
// was silence - generation that failed on every call because the key was
// identity-linked with no ANTHROPIC_WORKSPACE_ID, and venue photos that
// never appeared because GOOGLE_PLACES_API_KEY was on the worker but not on
// Vercel.
//
// So the worker says, on a short repeating clock, that it is alive and what
// it can see. Presence only - which names are set, never a single character
// of a value - because this is written into Redis and read back onto a web
// page, and a credential that reaches either of those places has leaked.

export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";

/** How often the worker refreshes the key. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;

/** How long the key survives without a refresh.
 *
 * Three intervals, so one slow write or one restart doesn't read as an
 * outage. The TTL is the whole mechanism: nothing deletes this key or marks
 * the worker down, it simply stops existing shortly after the process that
 * was writing it stopped running. */
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;

export interface WorkerHeartbeat {
  /** When this worker process started (ISO 8601). A startedAt that keeps
   * changing is a worker in a crash loop, which otherwise looks identical
   * to a healthy one from outside. */
  startedAt: string;
  /** When it last refreshed (ISO 8601). */
  updatedAt: string;
  /** Concurrent consumers this process is running. */
  concurrency: number;
  /** Names of the environment variables the worker can see. NEVER values. */
  envPresent: string[];
  /** Behaviour flags worth knowing when a generation looks wrong: which
   * model the day calls use, whether two-phase generation is on. */
  dayModel: string | null;
  twoPhase: boolean;
}

// ---------------------------------------------------------------------------
// Trip length
//
// The single most expensive thing a request can get wrong, and for a long
// while nothing checked it on either side.
//
// Phase 2 of generation makes ONE MODEL CALL PER PLANNED DAY, plus a Google
// Places pass over that day's venues, and the day count comes entirely from
// the brief's start_date and end_date. Both were validated as "a non-empty
// string" and nothing else, so `{"start_date":"2026-01-01","end_date":
// "2026-12-31"}` was a valid brief that commissioned 365 day calls from one
// HTTP request. The daily spend cap does not catch it: checkDailyBudget is
// a READ taken before the job runs, so the job that blows past the cap is
// the one that was never measured against it.
//
// This lives in the jobs.ts mirrors, next to the queue keys, because both
// sides need the same number: the app rejects an over-long brief at the
// door (a 400 the traveler can act on), and the worker refuses it again
// before its first model call, since it takes whatever is on the queue and
// is the side that actually spends. check:stats-keys holds the two copies
// to the same value.
//
// 30 is comfortably past any trip the product is designed for - the pace
// and budget models assume a holiday, not a season.

export const MAX_TRIP_DAYS = 30;

/** A calendar date as YYYY-MM-DD in UTC, or null if it isn't one.
 *
 * Deliberately stricter than Date.parse, which accepts "2026-13-45" and
 * rolls it over into the next year, along with bare years and a dozen other
 * shapes that would reach the prompt as a date nobody typed. UTC so the day
 * arithmetic can't be shifted by the host's timezone - the app and the
 * worker run in different ones. */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects a day that doesn't exist in that month - 2026-02-30 would
  // otherwise silently become March 2.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/** Inclusive day count between two calendar dates, or null if either isn't
 * one or they're out of order. */
export function tripDayCount(startIso: string, endIso: string): number | null {
  const start = parseCalendarDate(startIso);
  const end = parseCalendarDate(endIso);
  if (!start || !end) return null;
  if (end.getTime() < start.getTime()) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** How many days a brief covers, or null when its dates don't parse.
 *
 * Null means "can't tell", never "zero" - a caller enforcing the cap must
 * not treat an unreadable brief as a short one. */
export function briefSpanDays(brief: Pick<TripBriefInput, "start_date" | "end_date">): number | null {
  if (typeof brief?.start_date !== "string" || typeof brief?.end_date !== "string") return null;
  return tripDayCount(brief.start_date.trim(), brief.end_date.trim());
}
