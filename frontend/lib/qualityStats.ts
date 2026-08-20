// Reader for the rolling quality counters the worker writes after every
// generation (see worker/src/qualityStats.ts for the writer and the
// reasoning). Surfaced on /admin/stats.
//
// The keys and field names are duplicated here rather than imported
// because the two sides speak different Redis clients — the worker uses
// ioredis over TCP, the app uses the Upstash REST client — and this repo
// already duplicates shared engine code across that boundary for the same
// reason. Any change to a key name has to be made in both files.

import type { Redis } from "@upstash/redis";
import type { QualityCheckId } from "./jobs";

const QUALITY_DAYS_SEEN_KEY = "quality:days";
const dayHashKey = (day: string) => `quality:${day}`;

const FIELD = {
  jobs: "jobs",
  passed: "passed",
  groundedSum: "grounded_sum",
  itemSum: "item_sum",
} as const;

export const QUALITY_CHECKS: { id: QualityCheckId; label: string }[] = [
  { id: "meals_present", label: "Missing a meal" },
  { id: "no_duplicate_venues", label: "Same venue twice" },
  { id: "day_not_empty", label: "Day with nothing to do" },
  { id: "prices_present", label: "Missing a price" },
  { id: "lodging_per_night", label: "Wrong number of nights" },
  { id: "transport_legs", label: "No transport leg" },
  { id: "venues_named", label: "Generic venue (no name)" },
  { id: "lodging_named", label: "Generic accommodation" },
  { id: "grounded_ratio", label: "Low grounding" },
];

export interface QualitySnapshot {
  jobs: number;
  passed: number;
  /** Mean across every generation in the window. */
  avgGroundedPercent: number;
  /** How often each check fired, as a count of generations. */
  byCheck: Record<QualityCheckId, number>;
  /** Days actually covered by the numbers above. */
  dayCount: number;
}

const EMPTY_BY_CHECK = () =>
  Object.fromEntries(QUALITY_CHECKS.map((c) => [c.id, 0])) as Record<QualityCheckId, number>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Aggregates the last `windowDays` days of counters into one snapshot.
 *
 * Missing days are simply absent rather than zero-filled: a day with no
 * generations should not drag the average grounding toward zero, which is
 * what treating "no data" as "0%" would do. */
export async function loadQualitySnapshot(redis: Redis, windowDays = 30): Promise<QualitySnapshot> {
  const seen = ((await redis.smembers(QUALITY_DAYS_SEEN_KEY)) ?? []) as string[];
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  const days = seen.filter((d) => d >= cutoff).sort();

  if (days.length === 0) {
    return { jobs: 0, passed: 0, avgGroundedPercent: 0, byCheck: EMPTY_BY_CHECK(), dayCount: 0 };
  }

  const hashes = await Promise.all(
    days.map((day) => redis.hgetall<Record<string, string | number>>(dayHashKey(day)))
  );

  let jobs = 0;
  let passed = 0;
  let groundedSum = 0;
  const byCheck = EMPTY_BY_CHECK();
  let daysWithData = 0;

  for (const hash of hashes) {
    if (!hash) continue;
    daysWithData++;
    jobs += num(hash[FIELD.jobs]);
    passed += num(hash[FIELD.passed]);
    groundedSum += num(hash[FIELD.groundedSum]);
    for (const { id } of QUALITY_CHECKS) {
      byCheck[id] += num(hash[`defect:${id}`]) + num(hash[`warning:${id}`]);
    }
  }

  return {
    jobs,
    passed,
    avgGroundedPercent: jobs > 0 ? Math.round(groundedSum / jobs) : 0,
    byCheck,
    dayCount: daysWithData,
  };
}
