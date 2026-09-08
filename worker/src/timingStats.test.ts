// Tests the latency counters' bucketing and the shape of what gets
// written.
//
// Two things here are easy to get wrong and impossible to notice: a
// boundary that puts a 30.0s run on the wrong side of the target, and a
// stage that gets counted on runs where it never ran. Both would produce a
// panel that is confidently, specifically wrong - which is worse than an
// empty one, because the whole point of the counters is that they get
// trusted without being re-derived.
//
// Runs in milliseconds with no Redis: the write path is exercised against
// a fake pipeline that records the commands it was given.
//
// Run: npm run test:timing

import { bucketFor, recordTimingSample, TARGET_TOTAL_MS, TF } from "./timingStats";
import { check, finish, heading, section } from "./testutil";
import type { JobTimings } from "./jobs";
import type Redis from "ioredis";

heading("latency counters");

section("bucket boundaries");

check("a fast run lands under 20s", bucketFor(12_000) === "u20");
check("19.999s is still under 20s", bucketFor(19_999) === "u20");
check("exactly 20s moves up a bucket", bucketFor(20_000) === "u30");

// The one boundary that carries a promise. TARGET_TOTAL_MS is the line
// between "met the target" and "did not", and the panel adds the first two
// buckets to report it - so a run of exactly 30.000s must not be counted
// as on target, and 29.999s must be.
check("29.999s is on target", bucketFor(TARGET_TOTAL_MS - 1) === "u30");
check("exactly 30s is NOT on target", bucketFor(TARGET_TOTAL_MS) === "u45");

check("a 54.8s run - the last real measurement - lands in 45-60s", bucketFor(54_800) === "u60");
check("a two-minute run lands over 60s", bucketFor(120_000) === "o60");

section("what a sample writes");

/** Records the hincrby field names and amounts a sample produces, so the
 * write path can be checked without a Redis. */
function captureSample(timings: JobTimings): Map<string, number> {
  const fields = new Map<string, number>();
  const pipeline = {
    hincrby: (_key: string, field: string, amount: number) => {
      fields.set(field, (fields.get(field) ?? 0) + amount);
      return pipeline;
    },
    expire: () => pipeline,
    sadd: () => pipeline,
    exec: async () => [],
  };
  const redis = { multi: () => pipeline } as unknown as Redis;
  // recordTimingSample awaits only the pipeline's exec, which resolves
  // immediately here, so the map is fully populated by the time this
  // returns.
  void recordTimingSample(redis, timings);
  return fields;
}

const clean: JobTimings = {
  totalMs: 24_000,
  lodgingPrefetchMs: 3_000,
  generateMs: 16_000,
  venuesAndFlightsMs: 4_000,
  repairsMs: 1_000,
  dayCount: 4,
  dayWaves: 1,
};

const cleanFields = captureSample(clean);

check("counts the job", cleanFields.get(TF.jobs) === 1);
check("sums the total", cleanFields.get(TF.totalSum) === 24_000);
check("buckets it under 30s", cleanFields.get(TF.bucket("u30")) === 1);
check("records the stages that ran", cleanFields.get(TF.stage("generate")) === 16_000);

// The stage that only sometimes runs. Counting a zero for it on every
// clean generation would report re-verify as a fast stage, when in truth
// it is an absent one - and that is precisely the distinction that tells
// you whether repairs are costing whole seconds.
check(
  "does NOT record a stage that never ran",
  cleanFields.get(TF.stage("reverify")) === undefined,
  `got ${cleanFields.get(TF.stage("reverify"))}`
);
// The run count is what makes each stage average exact rather than
// diluted. A stage that ran must move both fields; one that didn't must
// move neither, or its average is divided by runs it was absent from.
check("a stage that ran counts one run", cleanFields.get(TF.stageRuns("generate")) === 1);
check(
  "a stage that never ran counts no runs",
  cleanFields.get(TF.stageRuns("reverify")) === undefined,
  `got ${cleanFields.get(TF.stageRuns("reverify"))}`
);

check("no time sink fires on a clean run", cleanFields.get(TF.waitedForFrame) === undefined);
check("one wave is not counted as multi-wave", cleanFields.get(TF.multiWave) === undefined);

section("the three known time sinks");

// The run this instrumentation was built for: lodging came back without a
// rate, so the trip frame went on the critical path.
const waited = captureSample({ ...clean, totalMs: 54_800, waitedForFrame: true });
check("waiting for the frame is counted", waited.get(TF.waitedForFrame) === 1);
check("and the run is bucketed at 45-60s", waited.get(TF.bucket("u60")) === 1);

const fellBack = captureSample({ ...clean, totalMs: 95_000, fellBackToSingleCall: true });
check("the single-call fallback is counted", fellBack.get(TF.fellBack) === 1);

const twoWaves = captureSample({ ...clean, totalMs: 48_000, dayWaves: 2 });
check("a second wave of day calls is counted", twoWaves.get(TF.multiWave) === 1);

check(
  "an undefined dayWaves is not counted as multi-wave",
  captureSample({ totalMs: 20_000 }).get(TF.multiWave) === undefined
);

finish();
