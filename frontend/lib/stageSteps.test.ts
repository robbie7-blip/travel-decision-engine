// Run: npm run test:stage-steps

import assert from "node:assert/strict";
import { stageSteps } from "./stageSteps";

const show = (stage: Parameters<typeof stageSteps>[0]) =>
  stageSteps(stage)?.map((s) => `${s.id}:${s.state}`).join(" ") ?? null;

// No stage published (an older worker, or still queued): no list at all,
// and the page keeps its old status line.
assert.equal(show(undefined), null);
assert.equal(show("nonsense" as never), null);

assert.equal(show("planning"), "planning:current writing:upcoming checking:upcoming finishing:upcoming");
assert.equal(show("writing"), "planning:done writing:current checking:upcoming finishing:upcoming");
assert.equal(show("checking"), "planning:done writing:done checking:current finishing:upcoming");
// Repairs appear only while they are happening...
assert.equal(show("repairing"), "planning:done writing:done checking:done repairing:current finishing:upcoming");
// ...and are not announced afterwards either: the list never shows a
// problem that was fixed as a step the traveller should wonder about.
assert.equal(show("finishing"), "planning:done writing:done checking:done finishing:current");

console.log("stageSteps: all assertions passed");
