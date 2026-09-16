// Finding the JSON in a model reply.
//
// Every phase-1 half, every day call and every repair parses its reply
// through here, and a failure is a ModelOutputError - which costs a retry,
// and if the retry does the same thing, abandons the two-phase path and
// regenerates the whole itinerary in one serial call.
//
// Pure, and in engine/ for the reason lib/weather.ts gives for its own
// averaging: it was inline in the worker's entry point, where testing it
// meant importing the process that starts the consumers, and that is where
// the gap was hiding.
//
// Run: npm run test:model-json

/** The JSON inside a model reply, wherever in it the model put it.
 *
 * WHY THIS IS NOT COSMETIC. Every phase-1 half, every day call and every
 * repair parses its reply through here, and a failure is a ModelOutputError
 * - which costs a retry, and if the retry does the same thing, abandons the
 * two-phase path and regenerates the whole itinerary in one serial call.
 * withOneRetryOf justifies that retry on the grounds that "malformed JSON is
 * non-deterministic, one retry usually succeeds". A PREAMBLE is not
 * non-deterministic. It is a habit, so the retry re-sends a request that
 * fails the same way, and the trip pays three calls and the slow path for a
 * sentence in front of the answer.
 *
 * The old version required the JSON to start at character zero, or a fence
 * to. Measured, on shapes a model actually produces:
 *
 *   bare JSON                  OK
 *   fenced json                OK
 *   fenced, unclosed           OK
 *   UPPERCASE fence            PARSE FAILS: Unexpected token 'J'
 *   preamble then fence        PARSE FAILS: Unexpected token 'H'
 *   preamble, no fence         PARSE FAILS: Unexpected token 'H'
 *   trailing prose, no fence   PARSE FAILS: Unexpected non-whitespace
 *
 * "Here is your itinerary:" in front of a fenced block is about the most
 * ordinary thing a model does, and the prompts saying "ONLY this JSON" are
 * exactly the kind of instruction plainDashes.ts already documents leaking.
 *
 * CANDIDATES, TRIED UNTIL ONE PARSES, rather than one cleverer extraction.
 * Guessing which slice is the payload is what the old version did, and it
 * guessed at position zero. Parsing is the only test that actually answers
 * it, it costs microseconds on text this size, and it means a wrong guess
 * cannot silently win - a fenced block that happens to sit inside the
 * model's prose loses to the real object further down. The last candidate is
 * the old behaviour, so a reply with no JSON in it at all still produces the
 * error message the caller expects, about the content the model really
 * sent. */
export function extractJson(text: string): string {
  const candidates: string[] = [];
  const push = (value: string | null | undefined): void => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    // The trailing-comma repair, applied per candidate: `{"a":1,}` is not
    // JSON and is a thing models write.
    const repaired = trimmed.replace(/,(\s*[}\]])/g, "$1");
    candidates.push(repaired);
    const balanced = balancedSlice(repaired);
    if (balanced && balanced !== repaired) candidates.push(balanced);
  };

  // A fenced block anywhere in the reply, with any language tag in any case
  // - not only one the reply opens with.
  for (const match of text.matchAll(/```[A-Za-z]*[ \t]*\r?\n?([\s\S]*?)```/g)) push(match[1]);
  push(text);

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Not this one.
    }
  }
  // Nothing parsed. Hand back the old behaviour's answer so the error the
  // caller raises names what the model actually sent.
  return candidates[candidates.length - 1] ?? text.trim();
}

/** The first balanced `{...}` or `[...]` in the text, or null.
 *
 * Brace counting, with strings and escapes respected, so prose on either
 * side is dropped without touching the object - `{"title": "Da Enzo}"}`
 * survives, which a first-brace-to-last-brace slice would also manage and a
 * first-to-first would not. */
function balancedSlice(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  // Unbalanced - genuinely truncated output, which the caller reports as
  // such rather than this guessing at a closing brace.
  return null;
}
