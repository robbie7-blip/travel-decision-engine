// One place for "read a number out of an environment variable".
//
// The naive form, `Number(process.env.X ?? fallback)`, is wrong in three
// ways that all look fine in review and all fail silently in production:
//
//   - An env var set to the empty string is present, so `??` does not fall
//     back - and `Number("")` is 0. On a quota that means every account is
//     locked out; on a rate limit it means every request is rejected.
//   - A typo ("5 " is fine, "5o" is not) gives NaN, which compares false
//     against everything, so a limit check silently stops limiting - and
//     the number still reaches the page, where the traveler is told they
//     have used all NaN of their free generations.
//   - A negative or zero value is accepted verbatim.
//
// costBudget.ts already had the right shape for floats (envFloat) but kept
// it private, so the other places that read numeric env vars each
// reinvented the broken version. This is that helper, shared - and it
// deliberately falls back rather than throwing: a bad env var should give
// the documented default, not take the site down at import time.
//
// Parsing goes through Number(), not parseInt/parseFloat, on purpose.
// parseInt reads a valid PREFIX and discards the rest, which trades one
// silent failure for a worse one: "6o" becomes 6 (a typo quietly honoured),
// and "1e5" becomes 1 rather than 100000 - so someone raising a rate limit
// to 100,000/hour would instead have set it to 1/hour, with nothing said.
// Number() takes the whole string or nothing.

/** Parses a whole trimmed string as a positive finite number, or null. */
function positiveNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** A positive integer from `name`, or `fallback` if it isn't one.
 *
 * A decimal is floored rather than rejected: someone typing 12.7 into a
 * "generations per month" field means 12, and refusing the value outright
 * would silently hand them the default instead of what they asked for. */
export function envInt(name: string, fallback: number): number {
  const parsed = positiveNumber(process.env[name]);
  if (parsed === null) return fallback;
  const floored = Math.floor(parsed);
  // A value between 0 and 1 floors to zero, which is the outage this helper
  // exists to prevent - fall back instead.
  return floored > 0 ? floored : fallback;
}

/** A positive number (integer or not) from `name`, or `fallback`. */
export function envFloat(name: string, fallback: number): number {
  return positiveNumber(process.env[name]) ?? fallback;
}

/** Same as envInt, for a value already read out of process.env.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the client bundle by
 * substituting the literal text of `process.env.NEXT_PUBLIC_FOO` at build
 * time - a dynamic `process.env[name]` lookup is NOT substituted and reads
 * as undefined in the browser. So the client-visible limits have to pass
 * the value in rather than the name, or the pricing page would silently
 * disagree with what the server enforces. */
export function positiveIntOr(raw: string | undefined, fallback: number): number {
  const parsed = positiveNumber(raw);
  if (parsed === null) return fallback;
  const floored = Math.floor(parsed);
  return floored > 0 ? floored : fallback;
}
