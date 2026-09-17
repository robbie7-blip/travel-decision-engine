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
  /** How long this job's Redis record should live, in seconds.
   *
   * On the RECORD rather than at each write site, because the worker
   * rewrites the job several times per generation with
   * `SET ... EX JOB_TTL_SECONDS` - so any longer lifetime chosen at
   * enqueue was silently reset to thirty days the moment a worker picked
   * the job up. Carrying it here is what makes the choice survive every
   * write, including the ones made by the other deployment.
   *
   * Absent means JOB_TTL_SECONDS. See ttlForJob. */
  ttlSeconds?: number;
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
  | "day_travel_time"
  | "prices_present"
  | "lodging_price_per_night"
  | "price_matches_tier"
  | "transport_legs"
  | "open_on_visit"
  | "time_to_visit"
  | "must_see_covered"
  | "budget_matches_items"
  | "grounded_ratio"
  // The frame's half. Every id above this line is about the days; these
  // three are the first checks on trip_summary/key_decisions/
  // things_to_skip and the budget minimum, which nothing scored - see the
  // note above them in engine/quality.ts.
  | "decisions_justified"
  | "skips_explained"
  | "minimum_covers_lodging";

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
  /** What phase 1's two halves spent their time on, decomposed.
   *
   * planMs and frameMs say how long each half took. They cannot say WHY,
   * and the two candidate whys have opposite fixes: a queue or a long
   * think is the effort setting and the prompt, a long tail is the shape
   * of what is being asked for. The plan call took 68.8s on a 102s
   * generation and both readings were argued from the same log without
   * either being settled - which cost another paid generation to ask
   * again.
   *
   * queueMs is time to the first stream event (the request left and the
   * model began), thinkMs is from there to the first character of output,
   * writeMs is the rest. They sum to the half's own elapsed time. */
  phase1Calls?: Record<string, { queueMs: number | null; thinkMs: number | null; writeMs: number | null; totalMs: number }>;
  /** Venue verification and the meal repairs, timed apart.
   *
   * venuesAndFlightsMs is the MAX of those two and has never said which
   * one it was. That decides whether moving the meal half off the
   * critical path too is worth solving - and it is a real question, since
   * the meal repairs need a set of every venue name already spoken for,
   * which is the one genuine cross-day dependency in the stage. */
  venuesMs?: number;
  mealRepairMs?: number;
  /** The part of venue verification that did NOT fit inside the
   * day-generation window.
   *
   * Verification now starts as each day lands rather than after they all
   * do (a Places lookup for day 1's restaurant does not need day 3 to
   * exist). Zero means the whole cost came off the critical path; a
   * positive number is what is left on it. A short trip generated in a
   * single wave has little window to overlap into, so a number close to
   * the full cost there is the expected answer rather than a failure. */
  verifyResidualMs?: number;
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
  /** Which model actually wrote the days.
   *
   * DAY_MODEL is a latency lever - phase 2 is mechanical enough that a
   * faster model is a real trade - and it defaults to MODEL, so today this
   * says the same thing twice. It is recorded anyway, because the moment
   * the dial is turned every number on this record means something
   * different, and "which model was this run on" is not a question a trip
   * from last week can answer retrospectively.
   *
   * Beside `efforts` for the same reason that field exists: a run that
   * carries its own configuration is a run that can be compared to the
   * next one. */
  dayModel?: string;
}

export const JOBS_QUEUE_KEY = "jobs:queue";
// 30 days - a finished job is also the payload behind a shareable /trip/[id]
// link (see app/trip/[jobId]), so this needs to outlive a single polling
// session by a lot, not just cover the few minutes generation takes.
export const JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

/** ~13 months, for a trip belonging to a signed-in account.
 *
 * Thirty days is the wrong number for the thing someone paid for. A trip
 * planned in January for a June holiday expires in February - not while
 * nobody is looking at it, but in the middle of the window it exists FOR,
 * and the /trip link someone bookmarked or shared just stops working with
 * no warning and nothing to recover.
 *
 * Longer than a year on purpose: an annual trip planned slightly earlier
 * this year than last must not fall off between the two. The account is
 * the boundary because it is the only durable identity the product has -
 * an anonymous generation is as likely to be an abandoned experiment as a
 * real plan, and those are what the thirty-day clock is actually for. */
export const SAVED_JOB_TTL_SECONDS = 60 * 60 * 24 * 400;

/** The lifetime a job's record should have, in seconds.
 *
 * Clamped, because this value comes off a stored record: a job written by
 * an older build has no ttlSeconds at all (hence the default), and a
 * malformed one must not be able to ask Redis for a nonsensical or
 * effectively infinite lifetime. Redis rejects a non-integer outright,
 * which would throw inside the worker's write path and lose a finished
 * generation. */
export function ttlForJob(job: { ttlSeconds?: number }): number {
  const requested = job.ttlSeconds;
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return JOB_TTL_SECONDS;
  }
  return Math.min(Math.floor(requested), SAVED_JOB_TTL_SECONDS);
}

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
// Failure diagnostics
//
// A failed generation tells the traveler one of seven sentences, and six of
// them name the cause. The seventh - "Unexpected error generating
// itinerary." - is the fallthrough in processJob's catch, and it means the
// thrown value matched none of the named cases: a TypeError on a
// model-written field, a Redis write that failed, anything at all. The real
// error and its stack go to console.error, which lives on Railway.
//
// So the one failure class that by definition does not say what happened is
// also the one whose diagnosis needs log access to the other deployment.
// That is the wrong way round, and it has now cost a paid generation: the
// only artifact of the last failure was a screenshot of that sentence.
//
// This puts the error where the operator already looks. A capped list in
// Redis, rendered on /admin/health behind the password - NOT on the job
// record, which /api/job/[id] serves unauthenticated to anyone holding the
// link (see publicJob's field-by-field allowlist), and not in the sentence
// the traveler reads.
//
// REDACTED, not raw. This is a value written into Redis and read back onto
// a web page, which is the exact pair the heartbeat note above refuses to
// let a credential near - and a client's error message is one of the few
// strings in this process that can carry one. ioredis names the connection
// target it could not reach, and `redis://default:<password>@host:6379` is
// a password in an error message. Every stored string goes through
// redactSecrets first.

export const WORKER_FAILURES_KEY = "worker:failures";

/** How many failures the list keeps. Enough to show a pattern across a
 * morning's runs, small enough that reading it is one Redis call. */
export const WORKER_FAILURES_KEPT = 25;

/** How long the list survives untouched. Two weeks: long enough that a
 * failure over a weekend is still there on Monday, short enough that it
 * does not become a permanent record of one bad afternoon. */
export const WORKER_FAILURE_TTL_SECONDS = 60 * 60 * 24 * 14;

/** Caps, so one enormous message cannot push the other 24 failures out of
 * a Redis value or off the page. */
const MAX_FAILURE_MESSAGE_CHARS = 500;
const MAX_FAILURE_STACK_FRAMES = 12;

export interface WorkerFailure {
  /** The job it threw on, so the record can be matched to the trip page. */
  jobId: string;
  /** When it threw (epoch ms). */
  at: number;
  /** The error's constructor name - "TypeError" is the whole diagnosis
   * about half the time, because it means a field the model wrote was not
   * the type its declaration claims. */
  name: string;
  /** The message, redacted and capped. */
  message: string;
  /** The stack as lines, redacted and capped. Never the raw stack: a
   * message embedded in frame zero would otherwise skip the redaction the
   * message itself gets. */
  stack: string[];
  /** Which timed stages had finished when it threw, in order. This is what
   * says WHERE, and it is the half a stack trace does not give: a stack
   * naming shape.ts is a different bug depending on whether verification
   * had already run. */
  reached: string[];
  /** The trip's length in days, or null. A count, not the brief - it is
   * the single strongest predictor of which failures reproduce, and it
   * discloses nothing about the traveler. */
  days: number | null;
}

/** Patterns that must never reach Redis or a web page.
 *
 * Ordered: the specific shapes first, then one deliberately blunt rule for
 * anything long and opaque enough to be a token. The Upstash REST token is
 * about a hundred characters of base64url with no recognisable prefix, so
 * no allowlist of key formats would catch it. 40 characters is past any
 * build hash or minified identifier a stack frame carries, and the cost of
 * a false positive here is one unreadable substring in a diagnostic - the
 * cost of a false negative is a published credential. */
const SECRET_PATTERNS: [RegExp, string][] = [
  // A URL's userinfo half. Every connection error prints its target.
  [/\/\/[^\s/@]*:[^\s/@]*@/g, "//[redacted]@"],
  // Prefixed provider keys: Anthropic, Stripe, and anything shaped like
  // them.
  [/\b(sk|rk|pk)[-_][A-Za-z0-9_-]{8,}/g, "$1-[redacted]"],
  // Google API keys, which is the family this product holds most of.
  [/\bAIza[0-9A-Za-z_-]{10,}/g, "AIza[redacted]"],
  // An Authorization header's value, however the client spelled the
  // scheme.
  [/\b(bearer|basic)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1$2[redacted]"],
  // The blunt rule, last.
  [/[A-Za-z0-9_-]{40,}/g, "[redacted]"],
];

/** Removes anything that looks like a credential from a diagnostic string. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Describes a thrown value without assuming it is an Error.
 *
 * `String(e)` is not safe on every throwable - a BigInt in a template
 * literal throws, and a plain object stringifies to "[object Object]",
 * which is the least useful thing a diagnostic can say. Nothing here may
 * throw: it runs inside the handler for something that already went
 * wrong. */
/** The most specific name available for what was thrown.
 *
 * `error.name` is not it. Every custom error in this codebase is declared
 * `class ModelOutputError extends Error {}` and none of them set `name`, so
 * `name` reads "Error" for all of them - and this field is the one the
 * operator scans first. The constructor's name is the real answer:
 * "ItineraryShapeError" says which layer rejected the model's output,
 * "Error" says nothing. Measured through processJob: a day-call failure
 * recorded itself as plain "Error" until this existed.
 *
 * Wrapped, because reading .constructor on a Proxy - which is what a
 * wrapped provider error can be by the time it reaches a catch - can
 * itself throw. */
function nameOfThrown(error: unknown): string {
  const err = error instanceof Error ? error : null;
  if (!err) return `non-Error (${typeof error})`;
  try {
    const ctor = err.constructor?.name;
    if (typeof ctor === "string" && ctor.length > 0 && ctor !== "Object") return ctor;
  } catch {
    // Fall through to err.name below.
  }
  return typeof err.name === "string" && err.name ? err.name : "Error";
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return "a thrown value that could not be described";
  }
}

/** Builds the record from whatever was caught.
 *
 * Total, not partial: every field has an answer for a thrown string, a
 * thrown null and a thrown Error alike, because the caller is a catch
 * block and the alternative to a thin record is no record. */
export function buildWorkerFailure(
  jobId: string,
  error: unknown,
  opts: { reached: string[]; days: number | null; now?: number }
): WorkerFailure {
  const err = error instanceof Error ? error : null;
  const stack = typeof err?.stack === "string" ? err.stack.split("\n") : [];
  return {
    jobId,
    at: opts.now ?? Date.now(),
    name: nameOfThrown(error),
    message: redactSecrets(describeThrown(error)).slice(0, MAX_FAILURE_MESSAGE_CHARS),
    stack: stack
      .map((line) => redactSecrets(line).trim())
      .filter((line) => line.length > 0)
      .slice(0, MAX_FAILURE_STACK_FRAMES),
    reached: opts.reached,
    days: typeof opts.days === "number" && Number.isFinite(opts.days) ? opts.days : null,
  };
}

/** True when what came out of the list is actually a failure record.
 *
 * Same reasoning as isJob above. This one is read straight onto a page, so
 * an older build's shape must render as "one record could not be read"
 * rather than throwing during the render of the page whose only job is to
 * say what is broken. */
export function isWorkerFailure(value: unknown): value is WorkerFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const f = value as Partial<WorkerFailure>;
  return (
    typeof f.jobId === "string" &&
    Number.isFinite(f.at) &&
    typeof f.name === "string" &&
    typeof f.message === "string" &&
    Array.isArray(f.stack) &&
    Array.isArray(f.reached)
  );
}

/** Reads one entry as either Redis client hands it back, or null. */
export function readWorkerFailure(raw: unknown): WorkerFailure | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isWorkerFailure(value)) return null;
  // The arrays are checked as arrays above and their contents are not, so
  // narrow them here rather than letting a stray number reach a render
  // that calls .trim() on it.
  return {
    ...value,
    stack: value.stack.filter((line): line is string => typeof line === "string"),
    reached: value.reached.filter((line): line is string => typeof line === "string"),
    days: typeof value.days === "number" && Number.isFinite(value.days) ? value.days : null,
  };
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
