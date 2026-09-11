// Reasoning effort: the levels, how they're read from the environment, and
// how one stage's ceiling is derived from the global setting.
//
// Lifted out of index.ts because the defaults stopped being a single value.
// MODEL_EFFORT applied to every call in the pipeline indiscriminately, and
// the measured numbers say the pipeline's calls are not remotely alike:
//
//   plan   68.8s   ~400 tokens of JSON      on the critical path
//   day    29.7s   ~1700 tokens of JSON     on the critical path
//   frame  >68.8s  ~700 tokens of JSON      free, runs alongside the days
//
// A call that produces 400 tokens of output and takes 68.8 seconds is
// spending almost all of it reasoning, and reasoning is what effort buys.
// So effort is now set per stage, and deriving a stage's default from the
// global one - rather than hard-coding a level - is what keeps
// MODEL_EFFORT=low still meaning low everywhere.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Ascending. The order is the API's own, and `capEffort` depends on it. */
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Reads an effort setting from the environment, refusing anything the API
 * would reject.
 *
 * These were blind casts, which made a typo in a dashboard field one of the
 * most expensive mistakes available: an invalid effort is a 400 on every
 * call that uses it, so mistyping the day-call setting would fail all of
 * phase 2, exhaust its retries, abandon the parallel path and regenerate the
 * whole itinerary in one serial call. Two minutes and a worse trip, with
 * nothing on the page explaining why.
 *
 * Case and whitespace are forgiven because a value typed into a web form
 * picks both up easily. Anything genuinely unrecognised falls back and says
 * so loudly, rather than being passed through to fail later. */
export function readEffort(name: string, fallback: Effort): Effort {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase() as Effort;
  if (EFFORTS.includes(normalized)) return normalized;
  console.error(
    `[worker] ${name}="${raw}" is not a valid effort (${EFFORTS.join(", ")}) - falling back to "${fallback}"`
  );
  return fallback;
}

/** `effort`, but never above `ceiling`.
 *
 * This is how a stage's default is expressed, and the direction matters. A
 * stage that caps at "medium" is saying "no more than this much reasoning
 * here, whatever the global setting is" - so raising MODEL_EFFORT to "max"
 * does not quietly put the capped stages back on the critical path, while
 * lowering it to "low" still means low everywhere. Hard-coding the level
 * instead would break the second half of that: MODEL_EFFORT=low would leave
 * the day calls thinking harder than the trip's own decisions.
 *
 * An unrecognised value is returned unchanged rather than guessed at -
 * readEffort is the thing that validates, and a second opinion here would
 * only disagree with it. */
export function capEffort(effort: Effort, ceiling: Effort): Effort {
  const at = EFFORTS.indexOf(effort);
  const max = EFFORTS.indexOf(ceiling);
  if (at < 0 || max < 0) return effort;
  return at > max ? ceiling : effort;
}
