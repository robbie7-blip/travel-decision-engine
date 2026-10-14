// The wait screen's step list, as data.
//
// Drawn only from the stage the worker last published (GenerationStage in
// lib/jobs.ts) - never from a timer - so a step is marked done because the
// worker moved past it, and the current one is what is actually running.
// "Replacing anything that did not check out" is only a step when it
// happens: most trips never need it, and listing it as upcoming on every
// trip would announce a problem that usually is not there.
//
// Run: npm run test:stage-steps

import type { GenerationStage } from "./jobs";

export type StepState = "done" | "current" | "upcoming";

export interface Step {
  id: GenerationStage;
  state: StepState;
}

const ORDER: GenerationStage[] = ["planning", "writing", "checking", "repairing", "finishing"];

export function stageSteps(stage: GenerationStage | undefined): Step[] | null {
  if (!stage) return null;
  const at = ORDER.indexOf(stage);
  if (at === -1) return null;
  return ORDER.filter((id) => id !== "repairing" || stage === "repairing").map((id) => {
    const i = ORDER.indexOf(id);
    return { id, state: i < at ? "done" : i === at ? "current" : "upcoming" };
  });
}
