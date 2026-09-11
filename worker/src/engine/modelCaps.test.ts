// Tests which models are sent output_config.effort.
//
// The stake is unusually lopsided for a predicate this small. Every day call
// carries the same request fields, so getting this wrong for the configured
// DAY_MODEL does not produce a worse trip - it 400s every day call and fails
// the whole generation. And DAY_MODEL exists specifically to invite a swap
// to a faster model, whose obvious candidate (Haiku 4.5) is one of the two
// that reject the field.
//
// Run: npm run test:model-caps

import { modelSupportsEffort } from "./modelCaps";
import { check, finish, heading, section } from "../testutil";

heading("model capabilities");

async function main() {
  section("models that reject output_config.effort");

  // The two that actually 400. Haiku is the one DAY_MODEL invites.
  check("haiku 4.5 does not take effort", modelSupportsEffort("claude-haiku-4-5") === false);
  check("sonnet 4.5 does not take effort", modelSupportsEffort("claude-sonnet-4-5") === false);
  // The exclusions have to beat the family match - a bare "sonnet" substring
  // test would sweep sonnet-4-5 back in.
  check("sonnet-4-5 is excluded despite being a sonnet", modelSupportsEffort("claude-sonnet-4-5") === false);
  check("any haiku is excluded", modelSupportsEffort("claude-haiku-9-9") === false);

  section("models that accept it");

  check("sonnet 5 (the current default) takes effort", modelSupportsEffort("claude-sonnet-5") === true);
  check("sonnet 4.6 takes effort", modelSupportsEffort("claude-sonnet-4-6") === true);
  check("opus 5 takes effort", modelSupportsEffort("claude-opus-5") === true);
  check("opus 4.8 takes effort", modelSupportsEffort("claude-opus-4-8") === true);
  check("fable 5.1 takes effort", modelSupportsEffort("claude-fable-5-1") === true);
  check("mythos 5.1 takes effort", modelSupportsEffort("claude-mythos-5-1") === true);

  section("the default day model must be compatible");

  // DAY_MODEL defaults to MODEL, which defaults to Sonnet 5. If this ever
  // flipped, every generation would fail on the DEFAULT configuration - the
  // one nobody sets and therefore nobody tests.
  check("the shipped default is compatible", modelSupportsEffort("claude-sonnet-5") === true);

  section("anything unrecognised gets the safe treatment");

  // Omitting effort costs a little speed. Sending it to a model that
  // rejects it fails the generation. So unknown means "don't send".
  check("an unknown model", modelSupportsEffort("some-new-model-2027") === false);
  check("an empty string", modelSupportsEffort("") === false);
  check("a non-string", modelSupportsEffort(undefined as unknown as string) === false);
  check("a typo in a real name", modelSupportsEffort("claude-onus-5") === false);

  section("case and formatting");

  check("uppercase is handled", modelSupportsEffort("Claude-Sonnet-5") === true);
  check("uppercase haiku is still excluded", modelSupportsEffort("CLAUDE-HAIKU-4-5") === false);

  finish();
}

main();
