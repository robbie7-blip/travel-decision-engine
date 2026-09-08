// Rolling latency counters, written by the worker after every successful
// generation and read by /admin/stats.
//
// Same argument as qualityStats.ts, applied to the other half of the
// promise. Every generation already measures itself in detail - lodging
// prefetch, both phases, verification, repairs, plus the flags for the
// three ways this pipeline loses twenty seconds at a stroke. All of it was
// written onto the job and then visible nowhere except that one trip's
// page, to the owner, if they still had the link.
//
// So the only way to answer "are we under 30 seconds" was to pay for a
// generation and open it. That is the exact loop qualityStats.ts was
// written to end for quality, and it matters more here, because the 30s
// target is the one number this product treats as non-negotiable and
// latency is the thing most likely to regress quietly - a slower model, a
// lodging lookup that starts coming back short, a trip long enough to need
// a second wave of day calls. None of those announce themselves.
//
// Real traveler generations answer it for free, continuously, and in
// larger numbers than the owner could afford to sample by hand.
//
// Counters, not a log of jobs - one Redis op, no storage growth, and the
// question being asked ("what share of generations came in under target")
// is exactly what a counter answers. Individual jobs keep their own full
// timings under their own keys for 30 days when a number does move.

import type Redis from "ioredis";
import type { JobTimings } from "./jobs";

/** ~90 days, matching the quality counters. */
const TIMING_TTL_SECONDS = 60 * 60 * 24 * 90;

/** The promise: a generation finishes within thirty seconds.
 *
 * Defined here, next to the buckets, so the page reporting the number and
 * the code bucketing it cannot disagree about where the line is. */
export const TARGET_TOTAL_MS = 30_000;

export function timingDayKey(date: Date = new Date()): string {
  return `timing:${date.toISOString().slice(0, 10)}`;
}

export const TIMING_DAYS_SEEN_KEY = "timing:days";

/** Where a generation's total lands.
 *
 * A mean would hide the shape: a handful of two-minute runs among many
 * fast ones averages to something that looks merely mediocre, when it is
 * actually a small number of travelers having a bad time. The boundary at
 * 30s is the target itself, so the first two buckets together are the
 * answer to the only latency question that matters here. */
export const TIMING_BUCKETS = [
  { id: "u20", label: "under 20s", maxMs: 20_000 },
  { id: "u30", label: "20-30s", maxMs: 30_000 },
  { id: "u45", label: "30-45s", maxMs: 45_000 },
  { id: "u60", label: "45-60s", maxMs: 60_000 },
  { id: "o60", label: "over 60s", maxMs: Infinity },
] as const;

export type TimingBucketId = (typeof TIMING_BUCKETS)[number]["id"];

export function bucketFor(totalMs: number): TimingBucketId {
  return (TIMING_BUCKETS.find((b) => totalMs < b.maxMs) ?? TIMING_BUCKETS[TIMING_BUCKETS.length - 1]).id;
}

/** The stages worth averaging. Deliberately not every field on JobTimings:
 * these are the five that appear on the critical path of every run, so
 * their averages add up to roughly the total and a regression in one is
 * visible as a change in its share. */
export const TIMING_STAGES = [
  { id: "lodging", label: "Lodging prefetch" },
  { id: "generate", label: "Generation (both phases)" },
  { id: "verify", label: "Places + flights" },
  { id: "repairs", label: "Repairs" },
  { id: "reverify", label: "Re-verify repairs" },
] as const;

export type TimingStageId = (typeof TIMING_STAGES)[number]["id"];

/** Field names inside the per-day hash. Functions rather than literals so
 * the frontend reader and this writer cannot drift. */
export const TF = {
  jobs: "jobs",
  totalSum: "total_sum",
  bucket: (id: TimingBucketId) => `b:${id}`,
  stage: (id: TimingStageId) => `s:${id}`,
  /** How many runs contributed to that stage's sum. Re-verify runs only
   * when something was repaired, so dividing its total by every run would
   * report a stage that looks fast on average when it is really absent
   * most of the time and slow when it happens. One extra increment buys an
   * average that is exact rather than one that needs a caveat. */
  stageRuns: (id: TimingStageId) => `n:${id}`,
  /** Phase 2 had to wait for the trip frame, because the lodging lookup
   * came back without a rate. Worth about twenty seconds on the run this
   * flag was added for, and invisible in the total. */
  waitedForFrame: "f:waited_for_frame",
  /** Two-phase generation failed and the whole itinerary was regenerated
   * through the single-call path - the most expensive thing that can
   * happen to a job. */
  fellBack: "f:fell_back",
  /** Day calls needed more than one wave, so phase 2 paid for its slowest
   * day more than once. Means MAX_PARALLEL_DAYS is below this trip's
   * length. */
  multiWave: "f:multi_wave",
} as const;

/** Best-effort by contract, like recordQualitySample - every call site
 * fires this without awaiting it. A stats write must never be the reason a
 * traveler's finished itinerary is delayed or lost.
 *
 * Only successful generations are sampled. A job that failed has a
 * totalMs, but it is the duration of a failure, not a latency, and mixing
 * the two would make an outage look like a speed-up (errors return fast). */
export async function recordTimingSample(redis: Redis, timings: JobTimings): Promise<void> {
  try {
    const key = timingDayKey();
    const day = key.slice("timing:".length);

    const pipeline = redis.multi();
    pipeline.hincrby(key, TF.jobs, 1);
    pipeline.hincrby(key, TF.totalSum, Math.round(timings.totalMs));
    pipeline.hincrby(key, TF.bucket(bucketFor(timings.totalMs)), 1);

    // Absent stages are skipped entirely - neither their sum nor their run
    // count moves - so each stage's average is over the runs it actually
    // ran in.
    const stageMs: Record<TimingStageId, number | undefined> = {
      lodging: timings.lodgingPrefetchMs,
      generate: timings.generateMs,
      verify: timings.venuesAndFlightsMs,
      repairs: timings.repairsMs,
      reverify: timings.verifyRepairsMs,
    };
    for (const { id } of TIMING_STAGES) {
      const ms = stageMs[id];
      if (ms === undefined) continue;
      pipeline.hincrby(key, TF.stage(id), Math.round(ms));
      pipeline.hincrby(key, TF.stageRuns(id), 1);
    }

    if (timings.waitedForFrame) pipeline.hincrby(key, TF.waitedForFrame, 1);
    if (timings.fellBackToSingleCall) pipeline.hincrby(key, TF.fellBack, 1);
    if ((timings.dayWaves ?? 1) > 1) pipeline.hincrby(key, TF.multiWave, 1);

    pipeline.expire(key, TIMING_TTL_SECONDS);
    pipeline.sadd(TIMING_DAYS_SEEN_KEY, day);
    await pipeline.exec();
  } catch (e) {
    console.error("[worker] failed to record timing sample:", e);
  }
}
