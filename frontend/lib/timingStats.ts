// Reader for the rolling latency counters the worker writes after every
// successful generation (see worker/src/timingStats.ts for the writer and
// the reasoning). Surfaced on /admin/stats.
//
// The keys and field names are duplicated here rather than imported
// because the two sides speak different Redis clients - the worker uses
// ioredis over TCP, the app uses the Upstash REST client - the same
// convention as qualityStats.ts. Any change to a key name has to be made
// in both files.

import type { Redis } from "@upstash/redis";

const TIMING_DAYS_SEEN_KEY = "timing:days";
const dayHashKey = (day: string) => `timing:${day}`;

/** The promise: a generation finishes within thirty seconds. Mirrors
 * TARGET_TOTAL_MS in the worker. */
export const TARGET_TOTAL_MS = 30_000;

export const TIMING_BUCKETS = [
  { id: "u20", label: "under 20s" },
  { id: "u30", label: "20-30s" },
  { id: "u45", label: "30-45s" },
  { id: "u60", label: "45-60s" },
  { id: "o60", label: "over 60s" },
] as const;

export type TimingBucketId = (typeof TIMING_BUCKETS)[number]["id"];

/** The first two buckets are, by construction, everything at or under the
 * target - the boundary between u30 and u45 is TARGET_TOTAL_MS itself. */
const ON_TARGET_BUCKETS: TimingBucketId[] = ["u20", "u30"];

export const TIMING_STAGES = [
  { id: "lodging", label: "Lodging prefetch" },
  { id: "generate", label: "Generation (both phases)" },
  { id: "verify", label: "Places + flights" },
  { id: "repairs", label: "Repairs" },
  { id: "reverify", label: "Re-verify repairs" },
] as const;

export type TimingStageId = (typeof TIMING_STAGES)[number]["id"];

const FIELD = {
  jobs: "jobs",
  totalSum: "total_sum",
  waitedForFrame: "f:waited_for_frame",
  fellBack: "f:fell_back",
  multiWave: "f:multi_wave",
} as const;

export interface TimingSnapshot {
  /** Successful generations sampled in the window. */
  jobs: number;
  /** Days actually covered by the numbers above. */
  dayCount: number;
  /** Mean total. Reported alongside the buckets, never instead of them. */
  avgTotalMs: number;
  /** How many came in at or under TARGET_TOTAL_MS. */
  onTarget: number;
  buckets: Record<TimingBucketId, number>;
  /** Mean milliseconds per stage, over the runs where that stage ran at
   * all. Null for a stage that never ran in the window. */
  stageAvgMs: Record<TimingStageId, number | null>;
  /** The three known ways a run loses a large block of time at once. */
  waitedForFrame: number;
  fellBackToSingleCall: number;
  multiWave: number;
}

const emptyBuckets = () =>
  Object.fromEntries(TIMING_BUCKETS.map((b) => [b.id, 0])) as Record<TimingBucketId, number>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const EMPTY_TIMING_SNAPSHOT: TimingSnapshot = {
  jobs: 0,
  dayCount: 0,
  avgTotalMs: 0,
  onTarget: 0,
  buckets: emptyBuckets(),
  stageAvgMs: Object.fromEntries(TIMING_STAGES.map((s) => [s.id, null])) as Record<
    TimingStageId,
    number | null
  >,
  waitedForFrame: 0,
  fellBackToSingleCall: 0,
  multiWave: 0,
};

/** Aggregates the last `windowDays` days of counters into one snapshot.
 *
 * Stage averages divide by that stage's own run count ("n:<stage>"), not
 * by the total number of jobs. Re-verify runs only when something was
 * repaired, so dividing its total by every run would report a stage that
 * looks fast on average when it is really absent most of the time and slow
 * when it happens - which is the opposite of what the number is for. */
export async function loadTimingSnapshot(redis: Redis, windowDays = 30): Promise<TimingSnapshot> {
  const seen = ((await redis.smembers(TIMING_DAYS_SEEN_KEY)) ?? []) as string[];
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  const days = seen.filter((d) => d >= cutoff).sort();

  if (days.length === 0) return EMPTY_TIMING_SNAPSHOT;

  const hashes = await Promise.all(
    days.map((day) => redis.hgetall<Record<string, string | number>>(dayHashKey(day)))
  );

  let jobs = 0;
  let totalSum = 0;
  let daysWithData = 0;
  let waitedForFrame = 0;
  let fellBackToSingleCall = 0;
  let multiWave = 0;
  const buckets = emptyBuckets();
  const stageSum: Record<string, number> = {};
  const stageRuns: Record<string, number> = {};

  for (const hash of hashes) {
    if (!hash) continue;
    daysWithData++;
    const dayJobs = num(hash[FIELD.jobs]);
    jobs += dayJobs;
    totalSum += num(hash[FIELD.totalSum]);
    waitedForFrame += num(hash[FIELD.waitedForFrame]);
    fellBackToSingleCall += num(hash[FIELD.fellBack]);
    multiWave += num(hash[FIELD.multiWave]);

    for (const { id } of TIMING_BUCKETS) buckets[id] += num(hash[`b:${id}`]);

    for (const { id } of TIMING_STAGES) {
      if (hash[`s:${id}`] === undefined) continue;
      stageSum[id] = (stageSum[id] ?? 0) + num(hash[`s:${id}`]);
      stageRuns[id] = (stageRuns[id] ?? 0) + num(hash[`n:${id}`]);
    }
  }

  const stageAvgMs = Object.fromEntries(
    TIMING_STAGES.map(({ id }) => [
      id,
      stageRuns[id] > 0 ? Math.round(stageSum[id] / stageRuns[id]) : null,
    ])
  ) as Record<TimingStageId, number | null>;

  return {
    jobs,
    dayCount: daysWithData,
    avgTotalMs: jobs > 0 ? Math.round(totalSum / jobs) : 0,
    onTarget: ON_TARGET_BUCKETS.reduce((sum, id) => sum + buckets[id], 0),
    buckets,
    stageAvgMs,
    waitedForFrame,
    fellBackToSingleCall,
    multiWave,
  };
}
