// What /api/trip-questions does when the model asks to look a place up.
//
// Extracted for the same reason refineSource.ts was: no route handler in
// this app has a test, because driving a Next route means standing up its
// request plumbing and a Redis client that reads process.env. So the
// decision lives here and the route is left holding the plumbing.
//
// The decision is small and it had a hang in it. The first version read:
//
//     if (tool_use && rounds < MAX) { ...lookups; continue; }
//     if (tool_use) { ...tell it no; continue; }
//
// which never ends. Once the rounds are spent, every pass takes the
// second branch, refuses again, and asks the model again - and the model,
// having asked twice already, asks a third time. Nothing in that loop
// stops, so the request runs until the serverless function is killed and
// the traveler watches a reply that never arrives. A model that keeps
// asking is not even unusual: "look up these five hotels" with a cap of
// four is enough.
//
// So refusal is a state, not a branch: it happens at most once, and a
// model that asks again after being refused gets the answer written from
// what is already in hand.

export type ToolStep =
  /** Run the model's lookups and let it continue with the results. */
  | { action: "lookups" }
  /** Tell the model it gets no more lookups, and give it one more turn to
   * write the answer with what it has. */
  | { action: "refuse" }
  /** Stop looping and deliver whatever the model has said. */
  | { action: "finish" };

export interface ToolRoundState {
  /** The model's stop_reason for the round that just finished. */
  stopReason: string | null;
  /** Rounds of real lookups already served. */
  toolRounds: number;
  /** Whether the model has already been told it gets no more. */
  refusedFurtherLookups: boolean;
  maxRounds: number;
}

export function nextToolStep(state: ToolRoundState): ToolStep {
  if (state.stopReason !== "tool_use") return { action: "finish" };
  if (state.toolRounds < state.maxRounds) return { action: "lookups" };
  if (!state.refusedFurtherLookups) return { action: "refuse" };
  return { action: "finish" };
}

/** The state after taking `step`. Kept beside the decision so the counter
 * and the decision that reads it cannot drift apart. */
export function applyToolStep(state: ToolRoundState, step: ToolStep): ToolRoundState {
  if (step.action === "lookups") return { ...state, toolRounds: state.toolRounds + 1 };
  if (step.action === "refuse") return { ...state, refusedFurtherLookups: true };
  return state;
}
