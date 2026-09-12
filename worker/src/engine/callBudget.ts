// Two halves of one job: keeping a paid model call bounded in time, and
// making it say what went wrong when it fails.
//
// Written after a real generation where the Rome accommodation lookup threw,
// retried, came back empty, and spent 30.9 seconds producing no nightly
// price. Every fact needed to fix that was missing from the log:
//
//   - The client is built with `timeout: CALL_TIMEOUT_MS` (120s) and
//     `maxRetries: 0`. 120 seconds is a deliberate ceiling for the calls
//     that MUST finish - the plan, a day - but the lodging lookup is a
//     best-effort side quest whose whole design is "degrade quietly", and it
//     inherited the ceiling anyway. A stuck lodging call was allowed to run
//     longer than the entire generation it was supposedly helping.
//   - The retry had no budget of its own either, so a slow first attempt and
//     a slow second attempt simply added up.
//   - The failure was logged as `console.error(msg, e)`, which prints a
//     stack. A stack says where the call was made from - which was never in
//     question - and not whether this was a 429, a 400, a timeout or a
//     malformed response. Those have four different fixes, and telling them
//     apart cost another paid generation.
//
// So: `startBudget` bounds a whole operation including its retries, handing
// each attempt the smaller of its own timeout and whatever is left, and
// refusing an attempt there is no longer time for. `describeModelError`
// turns a thrown value into one grep-able line and says whether trying
// again could plausibly do anything.
//
// Pure, injectable clock, no SDK import: testable without a key or a
// network. See callBudget.test.ts.

/** A wall-clock allowance for one operation, retries included. */
export interface CallBudget {
  /** Milliseconds left. Never negative. */
  remainingMs(): number;
  /** The timeout to hand the next attempt, or null when there is not
   * enough time left to be worth starting one.
   *
   * Returning null rather than a tiny timeout is the point: an attempt
   * launched with 400ms left is a paid call that cannot finish, which is
   * strictly worse than not making it. `minMs` is the caller's judgement of
   * "could this plausibly complete". */
  attemptTimeoutMs(perAttemptMs: number, minMs: number): number | null;
  /** How long the operation has been running, for the log line. */
  elapsedMs(): number;
}

export function startBudget(totalMs: number, now: () => number = Date.now): CallBudget {
  const startedAt = now();
  const deadline = startedAt + Math.max(0, totalMs);
  return {
    remainingMs: () => Math.max(0, deadline - now()),
    elapsedMs: () => Math.max(0, now() - startedAt),
    attemptTimeoutMs(perAttemptMs: number, minMs: number) {
      const remaining = Math.max(0, deadline - now());
      if (remaining < minMs) return null;
      return Math.min(Math.max(1, perAttemptMs), remaining);
    },
  };
}

/** The cap above which a NON-STREAMING request is refused by the SDK
 * before it is even sent.
 *
 * The SDK's rule, verified in its source and against a live local server:
 * a non-streaming request whose `max_tokens` implies a response that could
 * take over ten minutes throws "Streaming is required for operations that
 * may take longer than 10 minutes". It derives the estimate as sixty
 * minutes scaled by `max_tokens / 128000`, so the ceiling is the cap at
 * which that estimate reaches ten minutes.
 *
 * This matters because the guard is SKIPPED when the client carries an
 * explicit `timeout` (`if (!body.stream && timeout == null)`), and this
 * worker sets one. Phase 1 was therefore sending 24,000-token
 * non-streaming requests that the SDK itself considers unservable, with the
 * refusal suppressed by an unrelated setting - and what it was suppressing
 * was real, because on a non-streaming request the SDK's timeout covers the
 * whole generation rather than just the wait for headers. */
export const NONSTREAMING_MAX_TOKENS = Math.floor((128_000 * 10) / 60);

/** Whether a call at this cap has to stream.
 *
 * Use it to keep the split honest: anything above the ceiling MUST go
 * through the streaming path, and anything deliberately kept non-streaming
 * (because it wants a hard wall-clock ceiling, like the accommodation
 * lookup) must stay below it. */
export function requiresStreaming(maxTokens: number): boolean {
  return maxTokens > NONSTREAMING_MAX_TOKENS;
}

export interface DescribedError {
  /** The thrown value's class or `name`, e.g. "RateLimitError". */
  name: string;
  /** HTTP status, or null for a connection error, a timeout, an abort, or
   * anything that never reached the API. */
  status: number | null;
  /** The API's own `error.type`, e.g. "rate_limit_error",
   * "overloaded_error", "invalid_request_error". Null when absent. */
  type: string | null;
  /** The SDK's request id, which is the only thing that makes a single
   * failed call findable on the provider's side. */
  requestId: string | null;
  /** One line: no stack, no newlines, bounded length. */
  message: string;
  /** Whether making the identical call again could plausibly succeed.
   *
   * False means the API has told us this request is wrong - a bad model
   * name, an unsupported field, a missing key - and a retry will fail the
   * same way, at the same price, after the same wait. This is the case the
   * old code got wrong for free: `output_config.effort` is refused outright
   * by two of the models this worker can be pointed at, and the retry
   * turned one guaranteed 400 per lookup into two. */
  retryable: boolean;
  /** Everything above, formatted for a single console line. */
  line: string;
}

/** Statuses where the request itself is the problem, so repeating it
 * verbatim cannot help. 429 and 5xx are deliberately absent - those are
 * about capacity and timing, which a second attempt genuinely can change. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 405, 413, 414, 422]);

const MAX_MESSAGE_CHARS = 300;

/** Collapses a possibly multi-line SDK message into one bounded line, so
 * the log stays one entry per failure and stays searchable. */
function oneLine(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE_CHARS ? `${flat.slice(0, MAX_MESSAGE_CHARS - 1)}…` : flat;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function describeModelError(e: unknown): DescribedError {
  const bag: Record<string, unknown> =
    typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};

  // Constructor name FIRST, and this ordering is load-bearing. The SDK does
  // not override `name` on its error subclasses, so a real
  // BadRequestError/RateLimitError arrives with `name === "Error"` - reading
  // `name` first threw away the one word that says what happened. Verified
  // against the real SDK against a local server, not assumed: a faked error
  // object with `name` set agrees with either ordering, which is precisely
  // how this would have shipped looking tested.
  const constructorName =
    typeof e === "object" && e !== null && typeof e.constructor?.name === "string" && e.constructor.name !== "Object"
      ? e.constructor.name
      : null;
  const declaredName = readString(bag, "name");
  const name =
    (constructorName && constructorName !== "Error" ? constructorName : null) ??
    (declaredName && declaredName !== "Error" ? declaredName : null) ??
    constructorName ??
    declaredName ??
    (typeof e === "string" ? "thrown string" : "thrown non-error");

  const rawStatus = bag["status"];
  const status = typeof rawStatus === "number" && Number.isFinite(rawStatus) ? rawStatus : null;

  const type = readString(bag, "type");
  const requestId = readString(bag, "requestID") ?? readString(bag, "request_id");

  const message =
    readString(bag, "message") ?? (typeof e === "string" && e.trim() !== "" ? oneLine(e) : "(no message)");

  // A status we recognise as permanent is the only thing that makes a retry
  // pointless. Everything else - no status at all (connection reset, our own
  // deadline firing, a socket hangup), 429, 5xx, a status outside both sets -
  // gets a second chance, because the alternative is silently giving up on a
  // recoverable blip. The budget above is what stops that second chance from
  // being unbounded.
  const retryable = status === null ? true : !PERMANENT_STATUSES.has(status);

  const parts = [
    name,
    status === null ? "no HTTP status (never reached the API, or the connection broke)" : `HTTP ${status}`,
    type ? `type=${type}` : null,
    requestId ? `request=${requestId}` : null,
    retryable ? "retry may help" : "retry cannot help - the request itself is refused",
    oneLine(message),
  ].filter((p): p is string => p !== null);

  return { name, status, type, requestId, message: oneLine(message), retryable, line: parts.join(" | ") };
}
