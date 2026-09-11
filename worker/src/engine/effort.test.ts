// How reasoning effort is read and how a stage's ceiling is applied.
//
// Effort stopped being one global setting because the measured numbers said
// the pipeline's calls are not alike:
//
//   plan   68.8s   ~400 tokens of JSON      every day call waits on it
//   day    29.7s   ~1700 tokens of JSON     on the critical path
//   frame  31.6s   ~700 tokens of JSON      free, runs alongside the days
//
// The plan and the day calls therefore cap at "medium" while the frame does
// not cap at all. Two things about that have to hold, and they pull in
// opposite directions:
//
//   - raising MODEL_EFFORT must NOT quietly put the capped stages back on
//     the critical path, or the promise of a 30-second generation is one
//     dashboard edit from being broken with no warning;
//   - lowering MODEL_EFFORT must still mean low EVERYWHERE, or the day
//     calls end up thinking harder than the trip's own decisions - which is
//     what hard-coding the level instead of deriving it would do.
//
// And readEffort is the gate in front of all of it. An invalid effort is a
// 400 on every call that uses it, so a typo in a hosting dashboard field
// would fail all of phase 2, exhaust its retries, abandon the parallel path
// and regenerate the whole itinerary in one serial call.
//
// Run: npm run test:effort

import { EFFORTS, capEffort, readEffort, type Effort } from "./effort";
import { check, finish, heading, section } from "../testutil";

heading("reasoning effort");

/** Sets the variable (or removes it) and reads it back through readEffort. */
function read(value: string | undefined, fallback: Effort): Effort {
  const name = "TEST_EFFORT_VAR";
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  const got = readEffort(name, fallback);
  delete process.env[name];
  return got;
}

function main() {
  section("the ceiling holds in the direction that matters");

  {
    // The 30-second promise, as an assertion. MODEL_EFFORT is a single field
    // in a hosting dashboard; raising it must not silently un-cap the two
    // stages that sit on the critical path.
    check("high is capped to medium", capEffort("high", "medium") === "medium");
    check("xhigh is capped to medium", capEffort("xhigh", "medium") === "medium");
    check("max is capped to medium", capEffort("max", "medium") === "medium");
  }

  {
    // The other direction, which a hard-coded default would get wrong:
    // MODEL_EFFORT=low has to still mean low for the capped stages, not
    // raise them to the ceiling.
    check("low passes through untouched", capEffort("low", "medium") === "low");
    check("medium at its own ceiling is unchanged", capEffort("medium", "medium") === "medium");
  }

  {
    check("a ceiling of high still caps max", capEffort("max", "high") === "high");
    check("and lets high through", capEffort("high", "high") === "high");
    check("a ceiling of max caps nothing", capEffort("max", "max") === "max");
    check("the lowest ceiling caps everything above it", capEffort("max", "low") === "low");
  }

  {
    // The ordering is the API's own and capEffort reads it by index, so a
    // reordered list would silently invert the comparison.
    check("the levels are in ascending order", EFFORTS.join(",") === "low,medium,high,xhigh,max", EFFORTS.join(","));
  }

  {
    // Garbage in, unchanged out. readEffort is what validates; a second
    // opinion here would only disagree with it, and returning a guessed
    // level would send a value the caller never chose.
    check("an unknown effort is returned unchanged", capEffort("turbo" as Effort, "medium") === ("turbo" as Effort));
    check("an unknown ceiling caps nothing", capEffort("max", "fastest" as Effort) === "max");
  }

  section("reading the setting: the field a typo lands in");

  {
    check("a valid value is used", read("medium", "high") === "medium");
    check("every level is accepted", EFFORTS.every((e) => read(e, "high") === e));
  }

  {
    // A variable saved BLANK in a hosting dashboard is present, so `??`
    // never fires - the same shape that once set the free monthly quota to
    // zero and the generate rate limit to zero sitewide.
    check("an unset variable falls back", read(undefined, "high") === "high");
    check("an empty string falls back", read("", "high") === "high");
    check("whitespace only falls back", read("   ", "high") === "high");
  }

  {
    check("case is forgiven", read("MEDIUM", "high") === "medium");
    check("surrounding whitespace is forgiven", read("  low  ", "high") === "low");
    check("both at once", read(" XHigh ", "low") === "xhigh");
  }

  {
    // The expensive typo. Without this it reaches the API as-is and 400s
    // every call that carries it.
    check("a typo falls back rather than being passed through", read("meduim", "high") === "high");
    check("a near-miss falls back too", read("higher", "medium") === "medium");
    check("a number falls back", read("2", "high") === "high");
    check("an effort from another provider falls back", read("reasoning_effort=high", "medium") === "medium");
  }

  finish();
}

main();
