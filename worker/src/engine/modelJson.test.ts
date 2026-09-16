// Finding the JSON in a model reply.
//
// The old extractJson required the JSON to start at character zero, or a
// fence to. Measured, on shapes a model actually produces:
//
//   bare JSON                  OK
//   fenced json                OK
//   fenced, unclosed           OK
//   UPPERCASE fence            PARSE FAILS: Unexpected token 'J'
//   preamble then fence        PARSE FAILS: Unexpected token 'H'
//   preamble, no fence         PARSE FAILS: Unexpected token 'H'
//   trailing prose, no fence   PARSE FAILS: Unexpected non-whitespace
//
// WHY THAT IS EXPENSIVE, and not a formatting nicety. Every phase-1 half,
// every day call and every repair parses through here. A failure is a
// ModelOutputError, which withOneRetryOf retries on the explicit grounds
// that "malformed JSON is non-deterministic, one retry usually succeeds" -
// and a PREAMBLE is not non-deterministic. It is a habit. So the retry
// re-sends a request that fails identically, phase 1 or a day call fails
// twice, the two-phase path is abandoned, and the whole itinerary is
// regenerated in one serial call: three paid calls and the slow path,
// because the model said "Here is your itinerary:" first.
//
// And "ONLY this JSON" in the prompt is exactly the kind of instruction
// plainDashes.ts already documents leaking - it competes with everything
// else in a long prompt and with how the model writes by default.
//
// Run: npm run test:model-json

import { extractJson } from "./modelJson";
import { check, finish, heading, section } from "../testutil";

heading("the JSON in a model reply");

const BODY = '{"days":[{"day":1,"items":[]}]}';

/** What the caller does: extract, then parse. */
function parses(raw: string): boolean {
  try {
    JSON.parse(extractJson(raw));
    return true;
  } catch {
    return false;
  }
}

/** The parsed value, for asserting it is the RIGHT object and not merely
 * something that parsed.
 *
 * Returns a sentinel rather than throwing, because this file's whole point
 * is to be run against a REVERTED extractJson - and a helper that throws
 * there kills the tsx process on the first hard failure instead of
 * reporting all of them. That has already happened twice in this repo's
 * history; the sentinel is the fix both times. */
function parsed(raw: string): unknown {
  try {
    return JSON.parse(extractJson(raw));
  } catch {
    return "__did-not-parse__";
  }
}

function main() {
  {
    section("what already worked, and must keep working");

    check("bare JSON", parses(BODY));
    check("  and is the same object", JSON.stringify(parsed(BODY)) === BODY);
    check("a fenced json block", parses("```json\n" + BODY + "\n```"));
    check("a fence with no language tag", parses("```\n" + BODY + "\n```"));
    check("an unclosed fence", parses("```json\n" + BODY));
    check("leading blank lines", parses("\n\n```json\n" + BODY + "\n```"));
    check("a bare array reply", JSON.stringify(parsed('[{"day":1}]')) === '[{"day":1}]');

    // The trailing-comma repair, which models need often enough that it
    // predates everything else in this function.
    check("a trailing comma in an object", JSON.stringify(parsed('{"a":1,}')) === '{"a":1}');
    check("a trailing comma in an array", JSON.stringify(parsed('{"a":[1,2,]}')) === '{"a":[1,2]}');
    check("and inside a fence", JSON.stringify(parsed('```json\n{"a":1,}\n```')) === '{"a":1}');
  }

  {
    section("the four shapes that cost a retry and the slow path");

    const cases: [string, string][] = [
      ["an UPPERCASE fence", "```JSON\n" + BODY + "\n```"],
      ["a preamble before a fence", "Here is your itinerary:\n\n```json\n" + BODY + "\n```"],
      ["a preamble with no fence", "Here you go:\n" + BODY],
      ["trailing prose with no fence", BODY + "\n\nLet me know if you want changes."],
    ];
    for (const [name, raw] of cases) {
      check(`${name} now parses`, parses(raw), extractJson(raw).slice(0, 40));
      check("  and yields the real object", JSON.stringify(parsed(raw)) === BODY, JSON.stringify(parsed(raw)).slice(0, 60));
    }

    // Prose on both sides at once, and the other fence-language spellings.
    check("prose on both sides", JSON.stringify(parsed("Sure!\n" + BODY + "\nHope that helps.")) === BODY);
    check("a Json fence", parses("```Json\n" + BODY + "\n```"));
    check("a javascript fence", parses("```javascript\n" + BODY + "\n```"));
    check("a fence with trailing spaces after the tag", parses("```json   \n" + BODY + "\n```"));
    check("prose, fence, prose", JSON.stringify(parsed("As asked:\n```json\n" + BODY + "\n```\nAnything else?")) === BODY);
  }

  {
    section("the candidate order matters, not just the candidate set");

    // A fenced block that is NOT the payload. Trying candidates until one
    // PARSES is what makes this come out right - a cleverer single
    // extraction would take the fence and lose.
    const decoy = "As requested ```not json``` here it is:\n" + BODY;
    check("a decoy fence does not win", JSON.stringify(parsed(decoy)) === BODY, extractJson(decoy).slice(0, 40));

    // Two fences, the second one real.
    const two = "```text\nnope\n```\nand now:\n```json\n" + BODY + "\n```";
    check("the fence that parses wins", JSON.stringify(parsed(two)) === BODY, extractJson(two).slice(0, 40));
  }

  {
    section("a brace inside a string is not a brace");

    // Brace counting has to respect strings and escapes, or a venue name
    // with punctuation in it truncates the object.
    check('a } inside a value', JSON.stringify(parsed('Here:\n{"title":"Da Enzo}","a":1}')) === '{"title":"Da Enzo}","a":1}');
    check('a { inside a value', parses('Here:\n{"title":"Caf{e","a":1}'));
    check('an escaped quote then a brace', parses('Here:\n{"title":"Da \\"Enzo\\"}","a":1}'));
    check('a bracket inside a value', JSON.stringify(parsed('Here:\n{"title":"A [place]","a":1}')) === '{"title":"A [place]","a":1}');
    // A real itinerary item, prose either side, with the punctuation that
    // actually appears in venue names.
    const real = '{"time":"13:00","title":"Lunch at Roscioli (Salumeria, 1824)","venue_name":"Roscioli"}';
    check("a real item with commas and brackets in it", JSON.stringify(parsed("Sure:\n" + real + "\nEnjoy!")) === real);
  }

  {
    section("what genuinely cannot be parsed still says so");

    // The point of the last candidate being the old behaviour: the caller
    // raises ModelOutputError with this text in the message, and it has to
    // name what the model really sent rather than some slice of it.
    for (const [name, raw] of [
      ["prose only", "I cannot help with that."],
      ["a truncated object", '{"days":[{"day":1,'],
      ["an empty reply", ""],
      ["whitespace only", "   \n  "],
      ["an unclosed fence with no JSON", "```json\nnot json at all"],
    ] as [string, string][]) {
      check(`${name} does not parse`, parses(raw) === false, extractJson(raw).slice(0, 30));
      let threw = false;
      try {
        extractJson(raw);
      } catch {
        threw = true;
      }
      check("  and extracting it does not throw", threw === false);
    }

    // The message has to be about the real content. "I cannot help with
    // that." is a refusal, and diagnosing it as "bad JSON at character 0 of
    // {" would send whoever reads the log to the wrong place.
    check(
      "a refusal comes back as the refusal",
      extractJson("I cannot help with that.") === "I cannot help with that.",
      extractJson("I cannot help with that.")
    );
  }

  {
    section("nothing here invents a closing brace");

    // A truncated reply is a real failure with a real fix (the token cap,
    // which generatePhase1Half escalates). Guessing a `}` onto the end
    // would turn it into a silently half-formed itinerary, which is worse.
    const truncated = '{"days":[{"day":1,"items":[{"title":"Colosseum"';
    check("a truncated object is not repaired", parses(truncated) === false);
    check("  and is handed back whole for the error message", extractJson(truncated).includes("Colosseum"));
  }

  finish();
}

main();
