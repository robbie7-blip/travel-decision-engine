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
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

export function section(title: string): void {
  console.log(`\n${title}`);
}

export function heading(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

/** Prints the tally and exits with the right code. Call once, at the end. */
export function finish(): never {
  console.log(`\n${failures === 0 ? `ALL ${checks} PASSED` : `${failures} of ${checks} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
