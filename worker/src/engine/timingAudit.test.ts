// Does the timing line add up, and is the pipeline's shape encoded right?
//
// Generation latency here has been diagnosed by reasoning five times and
// been wrong three of them. Every round of instrumentation answered "how
// long did stage X take" and none of it answered the question that comes
// first: IS THE MEASURED TIME THE WHOLE TIME. If the stages sum to 85 of
// 102 seconds then seventeen seconds are happening somewhere nobody has
// instrumented, and every hour spent shaving the plan call is spent on the
// wrong half of the job.
//
// The subtraction is trivial. What this suite actually holds is which
// stages are SERIAL and which are CONCURRENT, because getting that wrong
// makes the audit worse than no audit - a number that looks like a
// measurement and is not:
//
//   - lodgingPrefetchMs runs ALONGSIDE generation, deliberately (it was
//     moved off the critical path). Add it and a job with a slow lookup
//     reports a negative remainder, which reads as "we found time".
//   - planMs and frameMs run alongside EACH OTHER, so phase 1 is the
//     slower of the two and never their sum.
//   - generate, verify, repairs and re-verify are strictly sequential.
//
// The fixtures below are the two real measured runs - 58.5s and 102.4s -
// so the arithmetic is checked against numbers this product actually
// produced rather than against round ones I chose.
//
// Run: npm run test:timing-audit

import { TARGET_MS, auditTimings } from "./timingAudit";
import { check, finish, heading, section } from "../testutil";
import type { JobTimings } from "../jobs";

heading("timing audit");

/** The 102.4s Rome run, as its log reported it: plan 68.8s, frame 31.6s. */
const ROME: JobTimings = {
  totalMs: 102_400,
  lodgingPrefetchMs: 29_200,
  generateMs: 88_000,
  skeletonMs: 68_800,
  planMs: 68_800,
  frameMs: 31_600,
  daysMs: 18_000,
  dayCount: 3,
  dayWaves: 1,
  venuesAndFlightsMs: 6_000,
  repairsMs: 4_000,
  verifyRepairsMs: 2_000,
};

function main() {
  section("the remainder, which is the point");

  {
    const a = auditTimings(ROME);
    // 88 + 6 + 4 + 2 = 100 of 102.4
    check("the serial stages are summed", a.accountedMs === 100_000, String(a.accountedMs));
    check("and the remainder is what is left", a.unaccountedMs === 2_400, String(a.unaccountedMs));
    check("2.4s of 102.4s is not worth a warning", !a.notes.some((n) => n.includes("outside every")), a.notes.join(" | "));
  }

  {
    // The concurrent stage that must never be added. 29.2s of lodging
    // prefetch ran alongside generation; counting it would put the
    // accounted time at 129s against a 102s total.
    const a = auditTimings(ROME);
    check("the lodging prefetch is not a serial stage", !a.stages.some((s) => /lodging/i.test(s.label)), JSON.stringify(a.stages.map((s) => s.label)));
    check("so the remainder stays positive", a.unaccountedMs > 0, String(a.unaccountedMs));
  }

  {
    // The failure this exists to surface: instrumented stages that do not
    // come close to the total.
    const a = auditTimings({ ...ROME, generateMs: 60_000 });
    check("a 30s hole is reported", a.unaccountedMs === 30_400, String(a.unaccountedMs));
    check("and named as such", a.notes.some((n) => n.includes("outside every instrumented stage")), a.notes.join(" | "));
    check("with both numbers in it", a.notes.some((n) => n.includes("30.4s") && n.includes("102.4s")), a.notes.join(" | "));
  }

  {
    // And the failure that means THIS FILE is wrong rather than the clock:
    // stages summing past the total can only happen if one of them is not
    // actually serial.
    const a = auditTimings({ ...ROME, totalMs: 50_000 });
    check("an over-sum is negative", a.unaccountedMs < 0, String(a.unaccountedMs));
    check(
      "and blames the model, not the measurement",
      a.notes.some((n) => n.includes("not actually serial") && n.includes("timingAudit.ts is wrong")),
      a.notes.join(" | ")
    );
  }

  section("which half of phase 1 is the slow one");

  {
    // Got wrong out loud once: the frame was called the slower half when
    // the plan was 68.8s against the frame's 31.6s. They run concurrently,
    // so the slower one IS phase 1 and the other one waits.
    const a = auditTimings(ROME);
    const note = a.notes.find((n) => n.includes("Phase 1 is"));
    check("the plan is named", note?.includes("day plan") === true, note);
    check("with its own number", note?.includes("68.8s") === true, note);
    check("and the other half's", note?.includes("31.6s") === true, note);
  }

  {
    const a = auditTimings({ ...ROME, planMs: 12_000, frameMs: 40_000 });
    const note = a.notes.find((n) => n.includes("Phase 1 is"));
    check("the frame is named when it is the slower one", note?.includes("trip frame") === true, note);
  }

  {
    // A refinement and a single-call fallback produce no plan at all, so
    // there is nothing to compare and nothing should be claimed.
    const a = auditTimings({ totalMs: 40_000, generateMs: 38_000 });
    check("no halves means no claim about them", !a.notes.some((n) => n.includes("Phase 1 is")), a.notes.join(" | "));
    check("and no generation remainder either", a.generateUnaccountedMs === null);
  }

  section("inside generation");

  {
    // 88s of generation against 68.8 + 18 = 86.8 leaves 1.2s of serial
    // work between the phases.
    const a = auditTimings(ROME);
    check("the inner remainder is computed", a.generateUnaccountedMs === 1_200, String(a.generateUnaccountedMs));
    check("and 1.2s is not called out", !a.notes.some((n) => n.includes("belongs to neither")), a.notes.join(" | "));
  }

  {
    const a = auditTimings({ ...ROME, generateMs: 100_000, totalMs: 115_000 });
    check("a large inner remainder is called out", a.notes.some((n) => n.includes("belongs to neither")), a.notes.join(" | "));
    check("with its number", a.notes.some((n) => n.includes("13.2s")), a.notes.join(" | "));
  }

  section("the floor - whether the target is reachable at all");

  {
    // The conclusion the other numbers only imply, and the reason to
    // compute it rather than argue it. Every round of latency work so far
    // has gone at phase 1 because it is the biggest single stage. But the
    // stages AFTER it do not care how fast it was: 18s of day calls, 12s
    // of verify and the two repair passes, 2.4s unaccounted.
    const a = auditTimings(ROME);
    check("an instant phase 1 still lands at 33.6s", a.floorMs === 33_600, String(a.floorMs));
    check("which is past the 30s target", a.floorMs > TARGET_MS);
    const note = a.notes.find((n) => n.includes("INSTANT phase 1"));
    check("and it says so", note !== undefined, a.notes.join(" | "));
    check("with the number", note?.includes("33.6s") === true, note);
    check("and the target", note?.includes("30s target") === true, note);
    check(
      "and names what sets the floor rather than leaving it to be guessed",
      note?.includes("day calls and the verify/repair passes") === true,
      note
    );
  }

  {
    // The other verdict, which has to be reachable or the note is just
    // pessimism with a number attached. Same run with the post-generation
    // work cut: days 8s, verify 3s, repairs 1s, re-verify 1s.
    const fast = auditTimings({
      ...ROME,
      totalMs: 55_000,
      generateMs: 48_000,
      daysMs: 8_000,
      venuesAndFlightsMs: 3_000,
      repairsMs: 1_000,
      verifyRepairsMs: 1_000,
    });
    check("a leaner run's floor is inside the target", fast.floorMs <= TARGET_MS, String(fast.floorMs));
    check(
      "and then phase 1 IS the whole gap",
      fast.notes.some((n) => n.includes("phase 1 is the whole gap")),
      fast.notes.join(" | ")
    );
  }

  {
    // Without a phase-1 number there is no "what if it were free" question
    // to answer, so nothing is claimed - a refinement and the single-call
    // fallback both land here.
    const a = auditTimings({ totalMs: 40_000, generateMs: 38_000 });
    check("no phase 1 means no floor claim", !a.notes.some((n) => n.includes("phase 1")), a.notes.join(" | "));
    check("and the floor is just the total", a.floorMs === 40_000, String(a.floorMs));
  }

  section("the things that change what a stage timing MEANS");

  {
    // A retry is a whole extra model call, so a stage timing with one in
    // it is two calls and not a slow one.
    const a = auditTimings({ ...ROME, retries: { "day plan": 1 } });
    check("a retry is reported", a.notes.some((n) => n.includes("retry")), a.notes.join(" | "));
    check("and named", a.notes.some((n) => n.includes("day plan: 1")), a.notes.join(" | "));
    check("as two calls, not one", a.notes.some((n) => n.includes("two model calls, not one")), a.notes.join(" | "));
  }

  {
    // Waves were invisible for weeks: the stage read "days: 48s" whether
    // the day calls ran once or twice.
    const a = auditTimings({ ...ROME, dayWaves: 2 });
    check("more than one wave is reported", a.notes.some((n) => n.includes("2 waves")), a.notes.join(" | "));
    check("a single wave is not", !auditTimings(ROME).notes.some((n) => n.includes("wave")), "");
  }

  {
    const a = auditTimings({ ...ROME, fellBackToSingleCall: true });
    check(
      "a fallback invalidates the phase-1 numbers out loud",
      a.notes.some((n) => n.includes("abandoned the two-phase path")),
      a.notes.join(" | ")
    );
  }

  {
    // The dominant stage is the answer to "what is slow", when there is one.
    const a = auditTimings(ROME);
    check("generation is named as the dominant stage", a.notes.some((n) => n.includes("generation is 86%")), a.notes.join(" | "));
  }

  section("shapes that must not produce a confident number");

  {
    const a = auditTimings({ totalMs: 0 });
    check("no total means no measurement", a.notes.some((n) => n.includes("nothing here is a measurement")), a.notes.join(" | "));
    check("and no stages", a.stages.length === 0);
  }

  {
    for (const [label, totalMs] of [
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["negative", -1],
    ] as [string, number][]) {
      let threw = false;
      let notes: string[] = [];
      try {
        notes = auditTimings({ totalMs }).notes;
      } catch {
        threw = true;
      }
      check(`a ${label} total does not throw`, threw === false);
      check("  and claims nothing", notes.length > 0, notes.join(" | "));
    }
  }

  {
    // A stage recorded as 0 or as a non-number is absent, not a stage that
    // took no time - the difference between "we measured zero" and "we did
    // not measure".
    const a = auditTimings({ totalMs: 10_000, generateMs: 9_000, repairsMs: 0, venuesAndFlightsMs: Number.NaN });
    check("a zero stage is not listed", !a.stages.some((s) => s.label === "repairs"), JSON.stringify(a.stages.map((s) => s.label)));
    check("nor is a NaN one", !a.stages.some((s) => s.label === "venues and flights"), JSON.stringify(a.stages.map((s) => s.label)));
    check("and the remainder absorbs them", a.unaccountedMs === 1_000, String(a.unaccountedMs));
  }

  {
    // Percentages have to be of something.
    const a = auditTimings({ totalMs: 20_000, generateMs: 10_000 });
    check("a stage share is a percentage of the total", a.stages[0].percent === 50, String(a.stages[0].percent));
  }

  finish();
}

main();
