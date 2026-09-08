// Keeps the stats writers (worker) and readers (frontend) speaking the
// same Redis keys.
//
// The worker writes these counters over ioredis and the app reads them
// over the Upstash REST client, so the two halves cannot import from one
// another and each spells out the key and field names by hand. That is a
// deliberate trade this repo already makes elsewhere - and it has one
// failure mode, which is that renaming a field on one side leaves the
// other reading a field nobody writes.
//
// Nothing about that failure looks like a failure. There is no error, no
// log line and no missing page; the panel simply reports zero, forever,
// which reads exactly like "no traffic yet". These counters exist to be
// trusted without being re-derived, so a silently empty one is worse than
// no panel at all.
//
// Same shape as checkDashes.mjs and checkCoverPhotos.mjs: no
// dependencies, runs in milliseconds, fails the build rather than waiting
// to be noticed.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

/** Anything that looks like a Redis key or hash field: a prefixed field
 * ("f:fell_back"), a key namespace ("timing:"), or a snake_case field
 * ("total_sum"). Prose and display labels are excluded by construction -
 * they contain spaces or capitals. */
const KEYISH = /^(?:[a-z]+:[a-z0-9_]*|[a-z0-9]+_[a-z0-9_]+|jobs|passed)$/;

function keyLiterals(path) {
  const source = readFileSync(path, "utf8");
  const found = new Set();
  // Plain "double-quoted" literals.
  for (const [, lit] of source.matchAll(/"([^"\n]+)"/g)) found.add(lit);
  // Template literals, whose namespace prefix is the part that has to
  // agree: `timing:${day}` on one side must not become `timings:${day}`.
  for (const [, prefix] of source.matchAll(/`([a-z]+):\$\{/g)) found.add(`${prefix}:`);
  for (const [, lit] of source.matchAll(/`([a-z]+:[a-z0-9_]+)`/g)) found.add(lit);
  return new Set([...found].filter((lit) => KEYISH.test(lit)));
}

const problems = [];

/** The check-id union the worker's quality gate can emit. The frontend
 * lists these by hand to give each one a label, so a new check would
 * otherwise be counted by the worker and displayed by nobody. */
function qualityCheckIds() {
  const source = readFileSync(join(REPO, "worker", "src", "jobs.ts"), "utf8");
  const block = source.slice(
    source.indexOf("export type QualityCheckId"),
    source.indexOf(";", source.indexOf("export type QualityCheckId"))
  );
  return new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
}

const checkIds = qualityCheckIds();

const PAIRS = [
  {
    name: "latency counters",
    writer: join(REPO, "worker", "src", "timingStats.ts"),
    reader: join(REPO, "frontend", "lib", "timingStats.ts"),
    // Symmetric: every key one side names, the other names too.
    readerOnlyAllowed: new Set(),
  },
  {
    name: "quality counters",
    writer: join(REPO, "worker", "src", "qualityStats.ts"),
    reader: join(REPO, "frontend", "lib", "qualityStats.ts"),
    // The reader legitimately spells out every check id to label it; the
    // writer gets them from the QualityCheckId type instead. Those are
    // verified against the union separately below.
    readerOnlyAllowed: checkIds,
  },
];

for (const pair of PAIRS) {
  const writer = keyLiterals(pair.writer);
  const reader = keyLiterals(pair.reader);

  const writerOnly = [...writer].filter((k) => !reader.has(k)).sort();
  const readerOnly = [...reader].filter((k) => !writer.has(k) && !pair.readerOnlyAllowed.has(k)).sort();

  if (writerOnly.length > 0) {
    problems.push(
      `${pair.name}: the worker writes key(s) the app never reads: ${writerOnly.join(", ")}`
    );
  }
  if (readerOnly.length > 0) {
    problems.push(
      `${pair.name}: the app reads key(s) the worker never writes: ${readerOnly.join(", ")}`
    );
  }
}

// Every check the gate can emit needs a label, or it is counted and never
// shown - the same silence, one level down.
const qualitySource = readFileSync(join(REPO, "frontend", "lib", "qualityStats.ts"), "utf8");
const labelled = new Set(
  [...qualitySource.matchAll(/\{\s*id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1])
);
const unlabelled = [...checkIds].filter((id) => !labelled.has(id)).sort();
const orphanLabels = [...labelled].filter((id) => !checkIds.has(id)).sort();

if (unlabelled.length > 0) {
  problems.push(
    `quality counters: check(s) the gate can emit with no label on /admin/stats: ${unlabelled.join(", ")}`
  );
}
if (orphanLabels.length > 0) {
  problems.push(
    `quality counters: label(s) for check(s) the gate can no longer emit: ${orphanLabels.join(", ")}`
  );
}

if (problems.length > 0) {
  console.error("Stats keys have drifted between the worker and the app.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nThese counters fail silently: a mismatched field reads as zero, which is\n` +
      `indistinguishable from "no traffic yet". Fix the name on both sides.`
  );
  process.exit(1);
}

console.log(
  `Stats keys agree across the worker/app boundary ` +
    `(${PAIRS.length} counter sets, ${checkIds.size} quality checks all labelled).`
);
