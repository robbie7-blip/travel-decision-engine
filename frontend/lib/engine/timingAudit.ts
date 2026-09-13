// Does the timing line add up?
//
// Generation latency in this pipeline has now been diagnosed by reasoning
// five times and been wrong three of them. The instrumentation added after
// each of those answers "how long did stage X take". It has never answered
// the question that comes first: IS THE MEASURED TIME THE WHOLE TIME.
//
// That matters more than any individual stage, because the failure mode is
// silent and expensive. If totalMs is 102 seconds and the stages sum to 85,
// then seventeen seconds are happening somewhere nobody has instrumented -
// and every hour spent shaving the plan call is spent on the wrong half of
// the job. The only way to find that out today is to add up the numbers on
// the admin panel by hand, which is exactly the kind of arithmetic nobody
// does and everybody assumes somebody did.
//
// The hard part is not the subtraction. It is knowing which stages are
// SERIAL and which are CONCURRENT, because adding a concurrent stage into
// the total produces a confident negative remainder and sends whoever reads
// it looking for time that was never lost:
//
//   - lodgingPrefetchMs runs ALONGSIDE generation (it was moved off the
//     critical path deliberately - see the prefetch comment in index.ts), so
//     it must never be added.
//   - planMs and frameMs run alongside EACH OTHER, so skeletonMs is the
//     slower of the two, not their sum.
//   - generate, verify, repairs and verifyRepairs are strictly sequential.
//
// So this file encodes the pipeline's own shape, and the test beside it is
// where that shape is actually asserted. Get it wrong and the audit is
// worse than no audit: a number that looks like measurement and is not.

import type { JobTimings } from "../jobs";

/** One serial stage's contribution to the wall clock. */
export interface StageShare {
  label: string;
  ms: number;
  /** Percentage of totalMs, rounded - what a reader actually wants. */
  percent: number;
}

export interface TimingAudit {
  totalMs: number;
  /** The serial stages, largest first. */
  stages: StageShare[];
  /** Everything the serial stages account for. */
  accountedMs: number;
  /** totalMs minus that. The number this file exists for.
   *
   * Expected to be small but NOT zero: the job read, the status writes, the
   * shape normalisations, the quality assessment and the final publish are
   * all real work that no stage wraps. Large means the instrumentation is
   * pointing at the wrong place. */
  unaccountedMs: number;
  /** Inside generation: generateMs minus (skeleton + days). Its own
   * remainder, because generation is the stage that dominates and "which
   * part of it" is a different question from "which stage". Null when
   * either half is missing, which is every refinement and every
   * single-call fallback. */
  generateUnaccountedMs: number | null;
  /** What this run would have totalled if PHASE 1 WERE FREE.
   *
   * The number that says whether the 30-second target is reachable at all
   * by tuning the thing everyone has been tuning. Every round of latency
   * work so far has gone at phase 1, because it is the biggest single
   * stage - but phase 1 is not the only serial stage, and the ones after
   * it do not care how fast it was. On the 102.4s run: the day calls are
   * 18s, verification and the two repair passes are 12s between them, 1.2s
   * is serial work inside generation and 2.4s is outside every stage. So
   * an INSTANT plan call still lands at 33.6 seconds, and the target is
   * unreachable without cutting something other than phase 1.
   *
   * 33.6, not the 32.4 this comment said until now: I added those stages
   * up by hand and dropped the 1.2s between the phases. The function got
   * it right and the prose did not, which is the argument for computing
   * it - and for not leaving a stale figure in the doc comment of the
   * field that computes it.
   *
   * Recomputed per run rather than written down, because the moment any
   * of those stages changes the conclusion changes with it. */
  floorMs: number;
  /** Plain sentences about what the numbers say. Written here rather than
   * in the component because they are conclusions about the pipeline, and
   * the pipeline is what this file knows about. */
  notes: string[];
}

/** The product's own stated generation target, in ms, and non-negotiable
 * per the brief this was built to. Here so the audit can say "the floor is
 * already past it" as arithmetic instead of as an opinion. */
export const TARGET_MS = 30_000;

/** Over this share of the total, a remainder is not rounding - it is a
 * stage nobody has instrumented. Ten percent of a 100-second generation is
 * ten seconds, which is a third of the entire budget. */
const UNACCOUNTED_CONCERN_RATIO = 0.1;

/** The share above which a stage is simply the answer to "what is slow". */
const DOMINANT_STAGE_RATIO = 0.4;

function share(label: string, ms: number | undefined, totalMs: number): StageShare | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return { label, ms, percent: totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0 };
}

export function auditTimings(timings: JobTimings): TimingAudit {
  const totalMs = Number.isFinite(timings.totalMs) ? timings.totalMs : 0;

  // SERIAL ONLY. lodgingPrefetchMs is deliberately absent - it runs
  // alongside generation, and adding it here would produce a negative
  // remainder on a job where the lookup was slow, which reads as "we found
  // time" rather than as a mistake in this list.
  const stages = [
    share("generation", timings.generateMs, totalMs),
    share("venues and flights", timings.venuesAndFlightsMs, totalMs),
    share("repairs", timings.repairsMs, totalMs),
    share("re-verify", timings.verifyRepairsMs, totalMs),
  ].filter((s): s is StageShare => s !== null);

  const accountedMs = stages.reduce((sum, s) => sum + s.ms, 0);
  const unaccountedMs = totalMs - accountedMs;

  const generateMs = timings.generateMs;
  const skeletonMs = timings.skeletonMs;
  const daysMs = timings.daysMs;
  const generateUnaccountedMs =
    typeof generateMs === "number" && typeof skeletonMs === "number" && typeof daysMs === "number"
      ? generateMs - (skeletonMs + daysMs)
      : null;

  const notes: string[] = [];

  // What would be left if phase 1 cost nothing. skeletonMs is phase 1's
  // whole wall-clock contribution (the slower half, plus any accommodation
  // wait), so removing it is exactly the "what if the plan call were
  // instant" question - and the answer is the floor every other stage
  // imposes regardless.
  const floorMs = typeof skeletonMs === "number" && Number.isFinite(skeletonMs) ? totalMs - skeletonMs : totalMs;

  if (totalMs <= 0) {
    notes.push("No total was recorded, so nothing here is a measurement.");
    return { totalMs, stages, accountedMs, unaccountedMs, generateUnaccountedMs, floorMs, notes };
  }

  if (unaccountedMs > totalMs * UNACCOUNTED_CONCERN_RATIO) {
    notes.push(
      `${Math.round(unaccountedMs / 100) / 10}s of ${Math.round(totalMs / 100) / 10}s is outside every ` +
        `instrumented stage. Whatever is being tuned inside those stages, this is the part nobody is looking at.`
    );
  } else if (unaccountedMs < 0) {
    // Only reachable if the serial/concurrent model above is wrong, which
    // is worth saying out loud rather than rendering as a negative bar.
    notes.push(
      `The stages sum to more than the total, which means one of them is not actually serial. ` +
        `The list in timingAudit.ts is wrong, not the clock.`
    );
  }

  const dominant = [...stages].sort((a, b) => b.ms - a.ms)[0];
  if (dominant && dominant.ms > totalMs * DOMINANT_STAGE_RATIO) {
    notes.push(`${dominant.label} is ${dominant.percent}% of the wall clock.`);
  }

  // Inside generation. planMs and frameMs run concurrently, so the slower
  // one IS phase 1 - and which one it is has been got wrong before, out
  // loud: the frame was called the slow half when the plan was 68.8s
  // against the frame's 31.6s.
  if (typeof timings.planMs === "number" && typeof timings.frameMs === "number") {
    const slower = timings.planMs >= timings.frameMs ? "day plan" : "trip frame";
    const slowerMs = Math.max(timings.planMs, timings.frameMs);
    const fasterMs = Math.min(timings.planMs, timings.frameMs);
    notes.push(
      `Phase 1 is the ${slower} at ${Math.round(slowerMs / 100) / 10}s; the other half finished in ` +
        `${Math.round(fasterMs / 100) / 10}s and then waited.`
    );
  }

  if (generateUnaccountedMs !== null && generateUnaccountedMs > 2000) {
    notes.push(
      `${Math.round(generateUnaccountedMs / 100) / 10}s inside generation belongs to neither phase 1 nor the ` +
        `day calls - it is serial work between them.`
    );
  }

  // A retry is a whole extra model call, and it is the one cause that makes
  // a stage timing mean something completely different.
  const retries = timings.retries;
  if (retries && Object.keys(retries).length > 0) {
    const total = Object.values(retries).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
    notes.push(
      `${total} silent retry/retries fired (${Object.entries(retries)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")}), so at least one stage here is two model calls, not one.`
    );
  }

  if (timings.dayWaves != null && timings.dayWaves > 1) {
    notes.push(
      `The day calls ran in ${timings.dayWaves} waves, so phase 2 paid its slowest day ${timings.dayWaves} times.`
    );
  }

  if (timings.fellBackToSingleCall) {
    notes.push(`This job abandoned the two-phase path entirely, so none of the phase-1 numbers describe it.`);
  }

  // The conclusion the rest of the numbers only imply. Stated last so it
  // reads as the verdict, and stated as arithmetic so it cannot be argued
  // with: this is what the run would have been with a free phase 1.
  if (typeof skeletonMs === "number" && Number.isFinite(skeletonMs)) {
    const tenths = (ms: number) => Math.round(ms / 100) / 10;
    if (floorMs > TARGET_MS) {
      notes.push(
        `Even with an INSTANT phase 1 this run would have taken ${tenths(floorMs)}s, which is already past the ` +
          `${tenths(TARGET_MS)}s target. The day calls and the verify/repair passes set that floor, so no amount of ` +
          `work on the plan call reaches the target on its own.`
      );
    } else {
      notes.push(
        `With a free phase 1 this run would have been ${tenths(floorMs)}s, inside the ${tenths(TARGET_MS)}s target - ` +
          `so phase 1 is the whole gap and is worth the work.`
      );
    }
  }

  return { totalMs, stages, accountedMs, unaccountedMs, generateUnaccountedMs, floorMs, notes };
}
