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
    stream: (params: P) => ({ finalMessage: () => create(params), abort: () => {} }),
  };
}

/** Prints the tally and exits with the right code. Call once, at the end. */
export function finish(): never {
  console.log(`\n${failures === 0 ? `ALL ${checks} PASSED` : `${failures} of ${checks} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
