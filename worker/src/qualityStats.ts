// Rolling quality counters, written by the worker after every generation
// and read by /admin/stats.
//
// The point of this file is to end a specific, repeated failure: the only
// way anyone found out that generation quality had regressed was the owner
// paying for a generation, opening it, and noticing something wrong in a
// screenshot — days or weeks after the commit that caused it. That made
// every quality question expensive to ask, which meant it mostly went
// unasked, which is how a broken accommodation lookup survived multiple
// deploys.
//
// Real traveler generations are already running through the acceptance
// gate (engine/quality.ts). Recording what the gate found turns that
// traffic into the regression signal — free, continuous, and far larger
// than any test the owner could afford to run by hand. "Did the last
// deploy break named hotels" becomes a number on a page instead of an
// afternoon.
//
// Deliberately counters, not a log of jobs. Two reasons: a counter costs
// one Redis op and no storage growth, and this is meant to answer "is the
// rate changing", which is exactly what a counter answers and what a pile
// of individual records makes you compute yourself. When a rate does move,
// the individual jobs are still there under their own keys for 30 days.

import type Redis from "ioredis";
import type { QualityCheckId, QualityReport } from "./engine/quality";

/** ~90 days. Long enough to see a regression against the same month last
 * quarter, short enough that abandoned keys eventually clear. */
const QUALITY_TTL_SECONDS = 60 * 60 * 24 * 90;

export function qualityDayKey(date: Date = new Date()): string {
  return `quality:${date.toISOString().slice(0, 10)}`;
}

export const QUALITY_DAYS_SEEN_KEY = "quality:days";

/** Field names inside the per-day hash. Kept as functions rather than
 * literals so the frontend reader and this writer cannot drift. */
export const QF = {
  jobs: "jobs",
  passed: "passed",
  groundedSum: "grounded_sum",
  itemSum: "item_sum",
  defect: (check: QualityCheckId) => `defect:${check}`,
  warning: (check: QualityCheckId) => `warning:${check}`,
} as const;

/** Best-effort by contract — every call site fires this without awaiting
 * it. A stats write must never be the reason a traveler's finished
 * itinerary fails to be delivered. */
export async function recordQualitySample(redis: Redis, report: QualityReport): Promise<void> {
  try {
    const key = qualityDayKey();
    const day = key.slice("quality:".length);

    const pipeline = redis.multi();
    pipeline.hincrby(key, QF.jobs, 1);
    if (report.passed) pipeline.hincrby(key, QF.passed, 1);
    pipeline.hincrby(key, QF.groundedSum, report.groundedPercent);
    pipeline.hincrby(key, QF.itemSum, report.itemCount);

    // One increment per DISTINCT check that fired, not per finding: three
    // days missing lunch is one broken meal rule, not three. Counting
    // findings would make a long trip look like a worse regression than a
    // short one with the same bug.
    const seen = new Set<string>();
    for (const finding of report.findings) {
      const field = finding.severity === "defect" ? QF.defect(finding.check) : QF.warning(finding.check);
      if (seen.has(field)) continue;
      seen.add(field);
      pipeline.hincrby(key, field, 1);
    }

    pipeline.expire(key, QUALITY_TTL_SECONDS);
    pipeline.sadd(QUALITY_DAYS_SEEN_KEY, day);
    await pipeline.exec();
  } catch (e) {
    console.error("[worker] failed to record quality sample:", e);
  }
}
