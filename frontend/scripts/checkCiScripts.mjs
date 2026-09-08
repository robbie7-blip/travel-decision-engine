// Every test and check script has to actually run in CI.
//
// This exists because of a mistake made in this repo, twice. A guard gets
// written, verified by hand, committed - and never added to
// .github/workflows/checks.yml. It then sits in package.json looking like
// protection while catching nothing, and the README says it "fails the
// build" when it does no such thing. `npm run test:hours` and
// `npm run test:timing` were both in that state; so was
// `npm run check:stats-keys`, a script whose entire job is catching silent
// drift.
//
// A dormant guard is worse than a missing one: a missing guard is a known
// gap, and a dormant guard is a false sense of one being covered.
//
// The workflow enumerates its steps individually rather than calling
// `npm test`, deliberately - each step carries a comment saying which past
// failure it exists to catch, and a failing step names itself. That is
// worth keeping; it just needs something making sure the list stays
// complete.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");

/** The scripts the workflow actually runs.
 *
 * Parsed from real `- run:` steps rather than searched for as substrings,
 * because a substring match has the two holes this script exists to close:
 * a commented-out `# - run: npm run test:timing` still reads as covered,
 * and `npm run test:hours-extended` would satisfy a search for
 * `test:hours`. Both leave a guard dormant while the check says it is
 * running - the precise failure being guarded against. */
const RUN_IN_CI = new Set(
  workflow
    .split("\n")
    // A step line, not a comment. YAML comments start with # after
    // whitespace; a real step starts with "- run:".
    .filter((line) => /^\s*-\s*run:/.test(line))
    .flatMap((line) => [...line.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]))
);

/** Scripts whose absence from CI is deliberate. Each needs a reason. */
const NOT_IN_CI = {
  // Aggregates the individual test:* steps the workflow already runs one
  // by one, so that each can carry its own comment and name itself when it
  // fails.
  test: "the workflow runs each suite as its own step",
  // Long-running or interactive, not a check.
  dev: "development server",
  start: "production server",
  lint: "not yet enforced - see the eslint config",
};

const problems = [];

for (const [pkgDir, label] of [
  ["worker", "worker"],
  ["frontend", "frontend"],
]) {
  const pkg = JSON.parse(readFileSync(join(REPO, pkgDir, "package.json"), "utf8"));
  const scripts = Object.keys(pkg.scripts ?? {});
  // Every script, not just the test:/check: ones. Scoping the loop to
  // those prefixes made all five NOT_IN_CI entries unreachable - dead
  // config documenting a mechanism that could never fire, while the
  // failure message pointed maintainers at it.
  for (const name of scripts) {
    if (name in NOT_IN_CI) continue;
    if (!RUN_IN_CI.has(name)) {
      problems.push(`${label}: "npm run ${name}" exists but never runs in CI`);
    }
  }
}

// The reverse: a step referring to a script that no longer exists fails
// the whole workflow on every push, which is loud rather than silent - but
// naming it here turns a confusing CI failure into an obvious one.
const workerScripts = Object.keys(
  JSON.parse(readFileSync(join(REPO, "worker", "package.json"), "utf8")).scripts ?? {}
);
const frontendScripts = Object.keys(
  JSON.parse(readFileSync(join(REPO, "frontend", "package.json"), "utf8")).scripts ?? {}
);
const known = new Set([...workerScripts, ...frontendScripts]);

for (const name of RUN_IN_CI) {
  if (!known.has(name)) {
    problems.push(`CI runs "npm run ${name}", which is not a script in either package.json`);
  }
}

if (problems.length > 0) {
  console.error("CI and package.json have drifted.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nAdd the missing step to .github/workflows/checks.yml with a comment saying\n` +
      `what it catches, or list it in NOT_IN_CI here with a reason. A guard that\n` +
      `does not run is worse than one that does not exist.`
  );
  process.exit(1);
}

console.log(`Every script runs in CI, or says why not (${RUN_IN_CI.size} steps).`);
