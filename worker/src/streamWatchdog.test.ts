// Tests for when a streamed model call is given up on.
//
// The bug these exist for: the worker armed ONE timer when a stream opened
// and never rearmed it, so a stream delivering text steadily was still
// aborted at 150 seconds. The constant was named STREAM_STALL_MS and the
// comment beside it said it was there to catch a stream that "goes quiet
// forever" - so the code and its own description disagreed, and no test
// could tell, because the timer lived inside a function that needs the
// Anthropic SDK to call.
//
// The first case below is exactly that difference: a stream touched every
// second must still be alive after ten times the idle deadline.
//
// Run: npm run test:stream-watchdog

import { startStreamWatchdog, type StreamGiveUpReason } from "./engine/streamWatchdog";
import { check, finish, heading, section } from "./testutil";

/** A clock whose timers only fire when time is advanced, so a test can
 * sit at 400 seconds without taking 400 seconds. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    /** Advances time, firing anything due, in time order. */
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) {
          if (entry[1].at <= target && (due === null || entry[1].at < due[1].at)) due = entry;
        }
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    get pending(): number {
      return timers.size;
    },
  };
}

function main(): void {
  heading("streamWatchdog");

  section("a busy stream is never given up on for being idle");
  {
    // THE REGRESSION TEST. The old code armed one timer and let it run, so
    // this is the case it got wrong: a stream producing events the whole
    // time, for far longer than the idle deadline.
    const clock = fakeClock();
    const reasons: StreamGiveUpReason[] = [];
    const dog = startStreamWatchdog({
      idleMs: 150_000,
      totalMs: 10 * 60_000,
      onGiveUp: (reason) => reasons.push(reason),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    // An event a second for 400 seconds: well past the 150-second idle
    // deadline the old timer was actually enforcing, and comfortably
    // inside the 10-minute total, so the only thing that could end it here
    // is the bug.
    for (let second = 0; second < 400; second++) {
      clock.advance(1_000);
      dog.touch();
    }
    check("still running after 400s of steady activity", reasons.length === 0, reasons.join(","));
    dog.stop();
  }

  section("a stream that goes quiet is given up on, at the idle deadline");
  {
    const clock = fakeClock();
    const reasons: StreamGiveUpReason[] = [];
    const dog = startStreamWatchdog({
      idleMs: 150_000,
      totalMs: 10 * 60_000,
      onGiveUp: (reason) => reasons.push(reason),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    clock.advance(149_999);
    check("not yet, a millisecond before", reasons.length === 0);
    clock.advance(2);
    check("given up on at the deadline", reasons.join(",") === "idle", reasons.join(","));
    // The original purpose, preserved: a dead stream dies on the same
    // schedule it always did.
    clock.advance(10 * 60_000);
    check("and only once", reasons.length === 1, reasons.join(","));
    dog.stop();
  }

  section("activity pushes the idle deadline out rather than resetting the total one");
  {
    const clock = fakeClock();
    const reasons: StreamGiveUpReason[] = [];
    const dog = startStreamWatchdog({
      idleMs: 100_000,
      totalMs: 240_000,
      onGiveUp: (reason) => reasons.push(reason),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    // Touched just inside the idle deadline, repeatedly. The idle timer
    // never fires; the TOTAL one eventually must, or a trickle of events
    // would hold a call open forever.
    for (let i = 0; i < 10; i++) {
      clock.advance(90_000);
      if (reasons.length === 0) dog.touch();
    }
    check("the total deadline is what ends it", reasons.join(",") === "total", reasons.join(","));
    dog.stop();
  }

  section("the total deadline fires even on a stream that never says anything");
  {
    const clock = fakeClock();
    const reasons: StreamGiveUpReason[] = [];
    const dog = startStreamWatchdog({
      // Total shorter than idle: an unusual configuration, and the one that
      // proves the two deadlines are independent rather than one of them
      // being derived from the other.
      idleMs: 300_000,
      totalMs: 60_000,
      onGiveUp: (reason) => reasons.push(reason),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    clock.advance(61_000);
    check("given up on for total time", reasons.join(",") === "total", reasons.join(","));
    dog.stop();
  }

  section("stop cancels everything, which is what the finally block relies on");
  {
    const clock = fakeClock();
    const reasons: StreamGiveUpReason[] = [];
    const dog = startStreamWatchdog({
      idleMs: 1_000,
      totalMs: 2_000,
      onGiveUp: (reason) => reasons.push(reason),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    check("two deadlines armed", clock.pending === 2, `${clock.pending}`);
    dog.stop();
    check("no timers left behind", clock.pending === 0, `${clock.pending}`);
    clock.advance(60_000);
    // A call that finished must never report a failure afterwards - the
    // abort would land on a stream that has already returned.
    check("a finished call never reports giving up", reasons.length === 0, reasons.join(","));
    // Called from a finally, so it has to tolerate running twice.
    dog.stop();
    check("stopping twice is harmless", reasons.length === 0);
    // And a late event from a stream being torn down must not rearm it.
    dog.touch();
    check("touching after stop does not rearm", clock.pending === 0, `${clock.pending}`);
  }

  section("nonsense deadlines are refused rather than silently disabling the guard");
  {
    // A zero or negative deadline would arm a timer that fires immediately
    // or never, depending on the platform, and either way the guard would
    // be gone - so this is worth refusing loudly. STREAM_STALL_MS is
    // readable from the environment, which is how a 0 would get here.
    for (const [idle, total] of [
      [0, 1000],
      [1000, 0],
      [-1, 1000],
      [Number.NaN, 1000],
    ]) {
      let threw = false;
      try {
        startStreamWatchdog({ idleMs: idle, totalMs: total, onGiveUp: () => {} });
      } catch {
        threw = true;
      }
      check(`refuses idle ${idle} total ${total}`, threw);
    }
  }

  finish();
}

main();
