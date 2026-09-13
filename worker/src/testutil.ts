// Minimal assertion helpers shared by the test files in this directory.
// Deliberately not a test framework: these suites run under `tsx` with no
// build step and no watcher, and the only things they need are "did this
// hold" and "exit non-zero if not".

let failures = 0;
let checks = 0;

export function check(label: string, cond: boolean, detail = ""): void {
  checks++;
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

export function section(title: string): void {
  console.log(`\n${title}`);
}

export function heading(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

/** Wraps a fake `messages.create` handler so the same handler also serves
 * `messages.stream`.
 *
 * index.ts STREAMS every call whose output can be large - the day plan, the
 * trip frame, a day, the single-call fallback - and keeps `create` for the
 * small ones (the accommodation lookup and the repairs), which deliberately
 * want a hard wall-clock ceiling. A fake client therefore needs both entry
 * points, and they must give the same answers: a suite that stubbed only
 * `create` went silently red the moment the real code started streaming,
 * and a suite that stubbed them differently would be testing a client that
 * does not exist. */
export function fakeMessages<P, R>(create: (params: P) => Promise<R>) {
  return {
    create,
    stream: (params: P) => {
      // `on` is part of the surface, not an extra.
      //
      // The real MessageStream is an emitter, and streamMessage subscribes
      // to `streamEvent` and `text` to measure where a call's time went -
      // queue, thinking, or writing, which have opposite fixes. A fake
      // without `on` is not a simpler client, it is a client that does not
      // exist: five suites died with "stream.on is not a function" the
      // moment the real code started listening, which is the same lesson
      // this helper was written for when only `create` was stubbed.
      //
      // Returns itself, because the real one is chainable. No events are
      // emitted, so a fake call reports null for queue and think - which
      // is the honest answer for a call that never touched a network.
      const stream = {
        finalMessage: () => create(params),
        abort: () => {},
        on: () => stream,
        off: () => stream,
        once: () => stream,
      };
      return stream;
    },
  };
}

/** Prints the tally and exits with the right code. Call once, at the end. */
export function finish(): never {
  console.log(`\n${failures === 0 ? `ALL ${checks} PASSED` : `${failures} of ${checks} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
