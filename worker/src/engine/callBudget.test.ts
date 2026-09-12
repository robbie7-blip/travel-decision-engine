// The two guards on a bounded, legible paid call.
//
// Both were written from one real generation: the Rome accommodation lookup
// threw, retried, came back empty, and spent 30.9 seconds returning no
// nightly price. The log said `lodging lookup failed for Rome:` followed by
// a stack trace - which named the line the call was made from, a fact
// nobody needed, and said nothing about whether this was a rate limit, a
// refused request, a broken connection or a truncated response. Those have
// four different fixes. Telling them apart would have cost another paid
// generation.
//
// So this covers, without a key or a network:
//
//   - that an operation's allowance actually bounds its RETRIES, not just
//     each attempt (the old retry had no budget: slow attempt plus slow
//     retry simply added up);
//   - that an attempt with too little time left is refused rather than
//     started, because a paid call that cannot finish is worse than no call;
//   - that a refused REQUEST (400, 401, 404) is not retried, while a rate
//     limit, a server error and a broken connection are. The worker can be
//     pointed at a model that rejects `output_config.effort` outright, and
//     retrying that turned one guaranteed 400 per lookup into two;
//   - that the failure line carries status, error type and request id, and
//     stays one searchable line with no stack and no newlines.
//
// Clock is injected, so the budget cases assert exact numbers instead of
// sleeping.
//
// Run: npm run test:call-budget

import { APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import {
  NONSTREAMING_MAX_TOKENS,
  describeModelError,
  requiresStreaming,
  startBudget,
} from "./callBudget";
import { check, finish, heading, section } from "../testutil";

heading("call budget and model-error description");

/** A clock the test drives by hand. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/** A REAL SDK error, built by the SDK's own factory.
 *
 * Deliberately not a hand-rolled `Object.assign(new Error(), {...})`. The
 * first version of this helper set `name` by hand, which made every case
 * here pass while the code under test was reading the wrong field - the SDK
 * does NOT override `name` on its subclasses, so a genuine BadRequestError
 * arrives with `name === "Error"` and only its CONSTRUCTOR knows what it is.
 * A fake that sets `name` agrees with either implementation, so it proved
 * nothing. Verified separately against the real SDK over a local HTTP
 * server; this keeps the suite honest about it. */
function apiError(status: number, type: string | null, message: string, requestID?: string): APIError {
  return APIError.generate(
    status,
    { type: "error", error: { type, message } },
    message,
    new Headers(requestID ? { "request-id": requestID } : {})
  );
}

function main() {
  section("the allowance bounds the whole operation, retries included");

  {
    const clock = fakeClock();
    const budget = startBudget(40_000, clock.now);
    check("a fresh budget reports its full allowance", budget.remainingMs() === 40_000, String(budget.remainingMs()));
    check("and no elapsed time", budget.elapsedMs() === 0, String(budget.elapsedMs()));

    clock.advance(18_000);
    check("time spent comes off the allowance", budget.remainingMs() === 22_000, String(budget.remainingMs()));
    check("and shows up as elapsed", budget.elapsedMs() === 18_000, String(budget.elapsedMs()));
  }

  {
    // The defect, as wall clock. Two 18s attempts used to be allowed to
    // become 36s because the retry carried no allowance of its own; now the
    // second attempt is handed only what is left.
    const clock = fakeClock();
    const budget = startBudget(25_000, clock.now);
    const first = budget.attemptTimeoutMs(18_000, 6000);
    check("the first attempt gets its own cap", first === 18_000, String(first));
    clock.advance(18_000);
    const second = budget.attemptTimeoutMs(18_000, 6000);
    check("the retry gets only what is left, not another full cap", second === 7000, String(second));
    clock.advance(7000);
    check(
      "and the pair cannot exceed the allowance",
      budget.remainingMs() === 0 && budget.elapsedMs() === 25_000,
      `${budget.remainingMs()} / ${budget.elapsedMs()}`
    );
  }

  {
    const clock = fakeClock();
    const budget = startBudget(40_000, clock.now);
    check("an attempt cap below the remaining time is used as-is", budget.attemptTimeoutMs(18_000, 6000) === 18_000);
    clock.advance(39_000);
    check("remaining never goes negative", budget.remainingMs() === 1000, String(budget.remainingMs()));
    clock.advance(10_000);
    check("even well past the deadline", budget.remainingMs() === 0, String(budget.remainingMs()));
  }

  section("an attempt there is no time for is refused, not started");

  {
    // This is the money case: a paid web-search call launched with three
    // seconds left cannot make its searches and read the result. It bills
    // and returns nothing.
    const clock = fakeClock();
    const budget = startBudget(20_000, clock.now);
    clock.advance(17_000);
    check("under the minimum, no attempt is offered", budget.attemptTimeoutMs(18_000, 6000) === null, String(budget.attemptTimeoutMs(18_000, 6000)));
  }

  {
    const clock = fakeClock();
    const budget = startBudget(20_000, clock.now);
    clock.advance(14_000);
    check("exactly at the minimum, an attempt IS offered", budget.attemptTimeoutMs(18_000, 6000) === 6000, String(budget.attemptTimeoutMs(18_000, 6000)));
  }

  {
    const clock = fakeClock();
    const budget = startBudget(20_000, clock.now);
    clock.advance(20_000);
    check("a spent budget offers nothing", budget.attemptTimeoutMs(18_000, 6000) === null);
    check("and an exhausted budget still reports elapsed honestly", budget.elapsedMs() === 20_000, String(budget.elapsedMs()));
  }

  {
    // A misconfigured allowance must not produce a zero or negative timeout,
    // which some HTTP clients read as "no timeout at all" - the exact
    // opposite of what was asked for.
    const clock = fakeClock();
    const budget = startBudget(0, clock.now);
    check("a zero allowance offers no attempt", budget.attemptTimeoutMs(18_000, 1) === null);
    const negative = startBudget(-5000, clock.now);
    check("a negative allowance is treated as spent, not as infinite", negative.attemptTimeoutMs(18_000, 1) === null);
    const tiny = startBudget(10, clock.now);
    check("a granted timeout is always at least 1ms", (tiny.attemptTimeoutMs(0, 0) ?? 0) >= 1, String(tiny.attemptTimeoutMs(0, 0)));
  }

  section("which calls are allowed not to stream");

  {
    // The ceiling the SDK enforces, and the reason phase 1 had to change.
    // Verified against the real SDK over a local server: a 24,000-token
    // NON-streaming request with no explicit client timeout throws
    // "Streaming is required for operations that may take longer than 10
    // minutes" before anything is sent. With an explicit timeout the guard
    // is skipped - which is the only reason this worker's phase 1 was not
    // failing on every request, and what it was hiding was that the timeout
    // then covered the whole generation rather than the wait for headers.
    check("the ceiling is the ten-minute estimate", NONSTREAMING_MAX_TOKENS === 21_333, String(NONSTREAMING_MAX_TOKENS));
    check("the phase-1 cap is above it, so phase 1 must stream", requiresStreaming(24_000) === true);
    check("a day call's cap is below it", requiresStreaming(16_000) === false);
    check("the single-call fallback's cap is below it", requiresStreaming(12_000) === false);
  }

  {
    // The two calls deliberately kept non-streaming, because they want a
    // hard wall-clock ceiling and with this SDK non-streaming is how you
    // get one: on a non-streaming request the timeout covers the whole
    // generation. LODGING_ATTEMPT_MS exists precisely for that.
    check("the accommodation lookup's cap stays non-streaming", requiresStreaming(2000) === false);
    check("the repair calls' cap stays non-streaming", requiresStreaming(1500) === false);
  }

  {
    check("exactly at the ceiling does not require streaming", requiresStreaming(NONSTREAMING_MAX_TOKENS) === false);
    check("one token over does", requiresStreaming(NONSTREAMING_MAX_TOKENS + 1) === true);
    check("the escalated phase-1 cap does", requiresStreaming(48_000) === true);
  }

  section("a refused REQUEST is not retried; a blip is");

  {
    // The concrete instance: DAY_MODEL can be pointed at a model that
    // rejects output_config.effort, and the API says so with a 400. Retrying
    // it is a second guaranteed failure at the same price after the same
    // wait.
    const d = describeModelError(apiError(400, "invalid_request_error", "output_config.effort: unsupported"));
    check("a 400 is not worth retrying", d.retryable === false, d.line);
    check("and the line says why", d.line.includes("retry cannot help"), d.line);
  }

  {
    check("a 401 is not worth retrying", describeModelError(apiError(401, "authentication_error", "invalid x-api-key")).retryable === false);
    check("a 404 is not worth retrying", describeModelError(apiError(404, "not_found_error", "model: nope")).retryable === false);
    check("a 422 is not worth retrying", describeModelError(apiError(422, "invalid_request_error", "bad")).retryable === false);
  }

  {
    check("a 429 IS worth retrying", describeModelError(apiError(429, "rate_limit_error", "slow down")).retryable === true);
    check("a 500 IS worth retrying", describeModelError(apiError(500, "api_error", "oops")).retryable === true);
    check("a 529 overload IS worth retrying", describeModelError(apiError(529, "overloaded_error", "overloaded")).retryable === true);
  }

  {
    // No status at all: a connection reset, a socket hangup, or our own
    // deadline firing. None of those say the request was wrong, so a second
    // attempt is legitimate - the budget, not this flag, is what keeps it
    // bounded. This is the exact class the SDK throws when a per-request
    // `timeout` fires, confirmed against a hung local server.
    const d = describeModelError(new APIConnectionTimeoutError({}));
    check("a timeout has no HTTP status", d.status === null, String(d.status));
    check("and is worth retrying", d.retryable === true);
    check("and says it never reached the API", d.line.includes("never reached the API"), d.line);
  }

  {
    const reset = new Error("read ECONNRESET");
    check("a bare connection error is worth retrying", describeModelError(reset).retryable === true);
  }

  {
    // Unknown statuses default to retryable: giving up on a recoverable
    // status we simply haven't catalogued is the more expensive mistake.
    check("an uncatalogued status defaults to retryable", describeModelError(apiError(418, null, "teapot")).retryable === true);
  }

  section("the line carries what the fix depends on");

  {
    const d = describeModelError(apiError(429, "rate_limit_error", "Number of requests has exceeded your limit", "req_abc123"));
    check("the error class is named", d.name === "RateLimitError", d.name);
    check("the status is numeric", d.status === 429, String(d.status));
    check("the API's own error type survives", d.type === "rate_limit_error", String(d.type));
    check("the request id survives, since it is the only handle on one call", d.requestId === "req_abc123", String(d.requestId));
    check("and all of it is in the line", d.line.includes("RateLimitError") && d.line.includes("HTTP 429") && d.line.includes("rate_limit_error") && d.line.includes("req_abc123"), d.line);
  }

  {
    // The trap the first version of this file walked into. The SDK leaves
    // `name` at the generic "Error" on every one of its subclasses, so if
    // `name` is preferred over the constructor the log says "Error" and the
    // single most useful word is gone. Asserted on a real SDK error, whose
    // own `name` really is "Error".
    const real = apiError(429, "rate_limit_error", "slow down");
    check("the real SDK error's own name field is the useless one", real.name === "Error", real.name);
    check("and the described name is the class anyway", describeModelError(real).name === "RateLimitError", describeModelError(real).name);
  }

  {
    // A plain Error with nothing else: there is no better word than "Error",
    // and it must not come out blank or as "thrown non-error".
    check("a plain Error is still named", describeModelError(new Error("boom")).name === "Error", describeModelError(new Error("boom")).name);
  }

  {
    // The whole point of describing rather than dumping: the log stays one
    // entry per failure. A stack made the cause scroll off the top of the
    // window, which is exactly how this bug stayed unidentified.
    const messy = new Error("line one\nline two\r\n   line three");
    const d = describeModelError(messy);
    check("newlines are collapsed", !d.line.includes("\n") && !d.line.includes("\r"), JSON.stringify(d.line));
    check("the words all survive", d.line.includes("line one line two line three"), d.line);
    check("no stack is included", !d.line.includes("at "), d.line);
  }

  {
    const long = new Error("x".repeat(5000));
    const d = describeModelError(long);
    check("a runaway message is bounded", d.message.length <= 300, String(d.message.length));
    check("and marked as truncated", d.message.endsWith("…"), d.message.slice(-5));
  }

  section("anything at all can be thrown");

  {
    const d = describeModelError("just a string");
    check("a thrown string does not throw here", d.message === "just a string", d.message);
    check("and is still classified", d.retryable === true && d.status === null, d.line);
  }

  {
    check("null does not throw", describeModelError(null).message === "(no message)", describeModelError(null).message);
    check("undefined does not throw", describeModelError(undefined).status === null);
    check("a number does not throw", describeModelError(42).name === "thrown non-error", describeModelError(42).name);
    check("an empty object gets a usable line", describeModelError({}).line.length > 0, describeModelError({}).line);
  }

  {
    // A status that is present but not a number (a string "429" from a
    // hand-rolled error, say) must not be treated as a status, or the
    // permanent-status set silently stops matching.
    const d = describeModelError({ status: "429", message: "stringly typed" });
    check("a non-numeric status is treated as absent", d.status === null, String(d.status));
    const nan = describeModelError({ status: Number.NaN, message: "nan" });
    check("NaN is treated as absent too", nan.status === null, String(nan.status));
  }

  {
    const d = describeModelError({ message: "   ", status: 400 });
    check("a blank message falls back rather than printing nothing", d.message === "(no message)", JSON.stringify(d.message));
    check("while the status is still read", d.status === 400 && d.retryable === false, d.line);
  }

  {
    const snake = describeModelError({ message: "m", request_id: "req_snake" });
    check("a snake_case request id is read too", snake.requestId === "req_snake", String(snake.requestId));
  }

  finish();
}

main();
