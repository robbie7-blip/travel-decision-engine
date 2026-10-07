// When to give up on a streamed model call.
//
// WHAT WENT WRONG. The worker armed one timer when a stream opened:
//
//   const stall = setTimeout(() => stream.abort(), STREAM_STALL_MS);
//
// and never rearmed it. That is a cap on TOTAL DURATION, not on going
// quiet - so a stream delivering text steadily for the whole time was
// aborted at 150 seconds anyway. The constant was called STREAM_STALL_MS
// and the comment beside it said it existed because "a stream that opens
// and then goes quiet forever would otherwise hang the job", so the code
// did something materially different from what it said it did, and nothing
// tested the difference.
//
// It surfaced on PUSHBACK, which is the call most exposed to it. A fresh
// generation fans out into one call per day, running in parallel, so no
// single call is long. A refinement is one call that regenerates the whole
// itinerary, start to finish, in sequence - so a thirteen-day trip is a
// single stream that can run well past 150 seconds while perfectly
// healthy. The traveller got an error reading "aborted" on a question
// about a trip that had generated fine minutes earlier.
//
// WHAT THIS DOES INSTEAD. Two deadlines, which is what was wanted all
// along:
//
//   - IDLE: nothing received for idleMs. This is the one the original
//     comment described, and it still fires at the same 150 seconds on a
//     stream that has genuinely died. Rearmed on every event, so activity
//     keeps it at bay.
//   - TOTAL: the whole call has run for totalMs, however busy it has been.
//     An idle timer alone can be held off forever by a trickle, and the
//     page gives up on its own schedule, so there has to be an outer
//     bound - the thing the old single timer was accidentally providing.
//
// The timer functions are injected so this is testable with a fake clock,
// without an SDK, a key or a network. Same reasoning as callBudget.ts.

export type StreamWatchdog = {
  /** Call on every event from the stream. Pushes the idle deadline out;
   * does nothing to the total one. */
  touch(): void;
  /** Cancel both deadlines. Safe to call more than once, and called from a
   * `finally` so it runs whether the call succeeded or threw. */
  stop(): void;
};

/** Why a call was given up on. Distinguished because they mean different
 * things: idle is a broken connection, total is a call that is too big for
 * the time it is allowed. */
export type StreamGiveUpReason = "idle" | "total";

export type StreamWatchdogOptions = {
  /** How long with NO events before the stream is abandoned. */
  idleMs: number;
  /** How long in total, however active it has been. */
  totalMs: number;
  /** What to do about it. Called at most once: the first deadline to fire
   * cancels the other, because two aborts on one stream is one real
   * failure and one confusing follow-up in the log. */
  onGiveUp: (reason: StreamGiveUpReason) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export function startStreamWatchdog({
  idleMs,
  totalMs,
  onGiveUp,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: StreamWatchdogOptions): StreamWatchdog {
  if (!(idleMs > 0) || !(totalMs > 0)) {
    throw new Error(`stream watchdog needs positive deadlines, got idle ${idleMs} total ${totalMs}`);
  }

  let done = false;
  let idleHandle: unknown = null;
  let totalHandle: unknown = null;

  const stop = (): void => {
    done = true;
    if (idleHandle !== null) clearTimer(idleHandle);
    if (totalHandle !== null) clearTimer(totalHandle);
    idleHandle = null;
    totalHandle = null;
  };

  const giveUp = (reason: StreamGiveUpReason): void => {
    // Guarded rather than trusted: an idle deadline and a total deadline
    // can be scheduled for the same tick, and the second one firing after
    // the stream is already aborted would log a second cause for one
    // failure.
    if (done) return;
    stop();
    onGiveUp(reason);
  };

  const armIdle = (): void => {
    if (done) return;
    if (idleHandle !== null) clearTimer(idleHandle);
    idleHandle = setTimer(() => giveUp("idle"), idleMs);
  };

  totalHandle = setTimer(() => giveUp("total"), totalMs);
  armIdle();

  return {
    touch: armIdle,
    stop,
  };
}
