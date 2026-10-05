// The loop that answers "look this place up", and the hang that was in it.
//
// The assertion that matters is the last section: a model that NEVER
// stops asking for lookups must still produce an answer. The first
// version of this logic did not - it refused, the model asked again, it
// refused again, and the request ran until the serverless function was
// killed, with the traveler watching a reply that never arrived.
//
// Driven as a real loop rather than as single calls, because "does this
// terminate" is not a property of one decision. A test that only checked
// each branch in isolation would have passed against the hanging version.
//
// Run: npm run test:tool-rounds

import { applyToolStep, nextToolStep, type ToolRoundState } from "./toolRounds";
import { check, finish, heading, section } from "./testutil";

const MAX = 2;

function start(): ToolRoundState {
  return { stopReason: "tool_use", toolRounds: 0, refusedFurtherLookups: false, maxRounds: MAX };
}

/** Runs the loop against a model described by `stopReasonFor`, and
 * returns the sequence of actions taken. Bounded so a hang fails as a
 * test rather than hanging the suite itself. */
function drive(stopReasonFor: (round: number) => string | null, limit = 50): string[] {
  const actions: string[] = [];
  let state = start();
  for (let round = 0; round < limit; round++) {
    state = { ...state, stopReason: stopReasonFor(round) };
    const step = nextToolStep(state);
    actions.push(step.action);
    if (step.action === "finish") return actions;
    state = applyToolStep(state, step);
  }
  return actions;
}

function main() {
  heading("ASK A LOCAL - the place-lookup round loop");

  section("the ordinary case: ask, look up, answer");
  {
    // The model asks once, gets its lookups, then writes the answer.
    const actions = drive((round) => (round === 0 ? "tool_use" : "end_turn"));
    check("one round of lookups, then done", actions.join(",") === "lookups,finish", actions.join(","));
  }

  section("an answer that needs no lookup at all");
  {
    const actions = drive(() => "end_turn");
    check("finishes immediately", actions.join(",") === "finish", actions.join(","));
    // max_tokens and a null stop_reason are not requests for a tool
    // either, and must not be mistaken for one.
    for (const reason of ["max_tokens", "stop_sequence", null]) {
      const only = drive(() => reason);
      check(`stop_reason ${String(reason)} finishes`, only.join(",") === "finish", only.join(","));
    }
  }

  section("a second round is allowed, because a first name can miss");
  {
    const actions = drive((round) => (round < 2 ? "tool_use" : "end_turn"));
    check(
      "two rounds of lookups are served",
      actions.join(",") === "lookups,lookups,finish",
      actions.join(",")
    );
  }

  section("a model that never stops asking still gets an answer out");
  {
    // THE test. Every round says tool_use, forever.
    const actions = drive(() => "tool_use");
    check(
      "the loop terminates",
      actions[actions.length - 1] === "finish",
      `ended on "${actions[actions.length - 1]}" after ${actions.length} steps`
    );
    check(
      "after exactly the rounds allowed, one refusal, and out",
      actions.join(",") === "lookups,lookups,refuse,finish",
      actions.join(",")
    );
    check(
      "and it never serves more lookups than the cap",
      actions.filter((a) => a === "lookups").length === MAX,
      String(actions.filter((a) => a === "lookups").length)
    );
    check(
      "nor refuses more than once - refusing on a loop IS the hang",
      actions.filter((a) => a === "refuse").length === 1,
      String(actions.filter((a) => a === "refuse").length)
    );
  }

  section("the model takes the hint after being refused");
  {
    // The expected shape of the refusal working: told it has no more
    // lookups, the model writes the answer.
    const actions = drive((round) => (round < 3 ? "tool_use" : "end_turn"));
    check(
      "refusal then answer",
      actions.join(",") === "lookups,lookups,refuse,finish",
      actions.join(",")
    );
  }

  section("the counters say what they mean");
  {
    const afterLookups = applyToolStep(start(), { action: "lookups" });
    check("a lookup round is counted", afterLookups.toolRounds === 1);
    check("and does not mark a refusal", afterLookups.refusedFurtherLookups === false);
    const afterRefuse = applyToolStep(start(), { action: "refuse" });
    check("a refusal is recorded", afterRefuse.refusedFurtherLookups === true);
    // A refusal is not a lookup: counting it as one would spend a round
    // the traveler never got the benefit of.
    check("and costs no lookup round", afterRefuse.toolRounds === 0);
    const afterFinish = applyToolStep(start(), { action: "finish" });
    check("finishing changes nothing", afterFinish.toolRounds === 0 && !afterFinish.refusedFurtherLookups);
  }

  finish();
}

main();
