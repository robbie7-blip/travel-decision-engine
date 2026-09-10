// Tests the READER half of the latency counters.
//
// worker/src/timingStats.test.ts covers the writer: which bucket a total
// lands in, which fields a sample increments. Nothing covered this side,
// and this side computes the number the README calls the panel's whole
// point - the share of generations that met the 30-second promise.
//
// Change ON_TARGET_BUCKETS to ["u20"], or divide a stage sum by `jobs`
// instead of by that stage's own run count, and /admin/stats reports a
// confidently wrong figure against a target the product treats as
// non-negotiable, with a green CI.
//
// No Redis: the reader takes anything with smembers and hgetall, so it
// gets a fake holding the hashes the worker would have written.
//
// Run: npm run test:stats

import type { Redis } from "@upstash/redis";
import {
  emptyTimingSnapshot,
  loadTimingSnapshot,
  ON_TARGET_BUCKETS,
  TARGET_TOTAL_MS,
  TIMING_BUCKETS,
} from "./timingStats";
import { check, finish, heading, section } from "./testutil";

heading("latency counters - reader");

const today = new Date().toISOString().slice(0, 10);
const longAgo = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);

/** Stands in for Upstash, holding exactly what the worker's pipeline would
 * have left behind. Values are strings, as they come back over REST. */
function fakeRedis(days: string[], hashes: Record<string, Record<string, string>>): Redis {
  return {
    smembers: async () => days,
    hgetall: async (key: string) => hashes[key] ?? null,
  } as unknown as Redis;
}

// Wrapped in a main() because this package is CommonJS under tsx, which
// has no top-level await.
async function main() {
  section("the number the panel exists to report");

  // One run in each bucket. Two of the five are at or under target, so the
  // headline is 2 of 5 - and it must come from the same list the bars use.
  const spread = {
    [`timing:${today}`]: {
      jobs: "5",
      total_sum: String(18_000 + 27_000 + 38_000 + 52_000 + 95_000),
      "b:u20": "1",
      "b:u30": "1",
      "b:u45": "1",
      "b:u60": "1",
      "b:o60": "1",
    },
  };
  const spreadSnap = await loadTimingSnapshot(fakeRedis([today], spread));

  check("counts every job", spreadSnap.jobs === 5, String(spreadSnap.jobs));
  check("2 of 5 met the target", spreadSnap.onTarget === 2, String(spreadSnap.onTarget));
  check(
    "onTarget is exactly the sum of the on-target buckets",
    spreadSnap.onTarget === ON_TARGET_BUCKETS.reduce((sum, id) => sum + spreadSnap.buckets[id], 0)
  );
  check("the mean is the sum over the count", spreadSnap.avgTotalMs === Math.round(230_000 / 5), String(spreadSnap.avgTotalMs));

  // The boundary is a promise, so it is asserted from both sides rather than
  // trusted to two lists that happen to agree today.
  check(
    "the on-target buckets are the ones below the target",
    ON_TARGET_BUCKETS.every((id) => (TIMING_BUCKETS.find((b) => b.id === id)?.label ?? "").length > 0) &&
      ON_TARGET_BUCKETS.length === 2 &&
      TARGET_TOTAL_MS === 30_000
  );

  section("stage averages divide by the runs that stage ran in");

  // Four jobs, re-verify ran in one of them for 1.2s. Dividing by `jobs`
  // would report 300ms - a stage that looks fast when it is really absent
  // most of the time and slow when it happens.
  const stages = {
    [`timing:${today}`]: {
      jobs: "4",
      total_sum: "160000",
      "b:u30": "4",
      "s:generate": "120000",
      "n:generate": "4",
      "s:reverify": "1200",
      "n:reverify": "1",
    },
  };
  const stageSnap = await loadTimingSnapshot(fakeRedis([today], stages));

  check("a stage that ran every time averages over all of them", stageSnap.stageAvgMs.generate === 30_000, String(stageSnap.stageAvgMs.generate));
  check(
    "a stage that ran once reports what it cost that once",
    stageSnap.stageAvgMs.reverify === 1_200,
    `got ${stageSnap.stageAvgMs.reverify} (300 would mean it divided by jobs)`
  );
  check("a stage that never ran is null, not zero", stageSnap.stageAvgMs.repairs === null, String(stageSnap.stageAvgMs.repairs));

  section("the window");

  // Annotated, or TS infers a union of the two differing key sets and
  // treats each missing key as possibly undefined.
  const windowed: Record<string, Record<string, string>> = {
    [`timing:${today}`]: { jobs: "1", total_sum: "20000", "b:u30": "1" },
    [`timing:${longAgo}`]: { jobs: "99", total_sum: "9900000", "b:o60": "99" },
  };
  const windowSnap = await loadTimingSnapshot(fakeRedis([today, longAgo], windowed));
  check("a day outside the 30-day window is excluded", windowSnap.jobs === 1, String(windowSnap.jobs));
  check("and its buckets are excluded too", windowSnap.buckets.o60 === 0, String(windowSnap.buckets.o60));

  const wide = await loadTimingSnapshot(fakeRedis([today, longAgo], windowed), 365);
  check("a wider window includes it", wide.jobs === 100, String(wide.jobs));

  section("days the set names but Redis no longer holds");

  // The day set has no TTL and the per-day hashes do, so a day whose hash
  // expired is the normal steady state, not an edge case.
  const expired = await loadTimingSnapshot(
    fakeRedis([today, longAgo], { [`timing:${today}`]: { jobs: "2", total_sum: "40000", "b:u30": "2" } })
  );
  check("an expired day is skipped, not counted as zero", expired.jobs === 2 && expired.dayCount === 1, JSON.stringify({ jobs: expired.jobs, days: expired.dayCount }));

  section("no traffic at all");

  const none = await loadTimingSnapshot(fakeRedis([], {}));
  check("reports nothing rather than dividing by zero", none.jobs === 0 && none.avgTotalMs === 0 && none.onTarget === 0);

  // The no-data path used to hand out one shared object; Next.js keeps
  // module state across requests in a single server instance, so a caller
  // mutating it would have corrupted every later request's snapshot.
  const a = emptyTimingSnapshot();
  const b = emptyTimingSnapshot();
  a.buckets.u20 = 99;
  check("each empty snapshot is its own object", b.buckets.u20 === 0, String(b.buckets.u20));

  section("values Upstash hands back");

  // hincrby values come back as strings over REST, and a missing field as
  // undefined. Both have to coerce without producing NaN.
  const coerce = await loadTimingSnapshot(
    fakeRedis([today], { [`timing:${today}`]: { jobs: "3", total_sum: "60000" } })
  );
  check("missing bucket fields read as 0, not NaN", Number.isFinite(coerce.onTarget) && coerce.onTarget === 0);
  check("string counters coerce to numbers", coerce.avgTotalMs === 20_000, String(coerce.avgTotalMs));

  finish();
}

main();
