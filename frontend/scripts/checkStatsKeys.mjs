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

/** The ids inside a `[{ id: "x", ... }]` table. Bucket and stage ids are
 * not string literals the key extractor can see - both sides build their
 * field names as `b:${id}` - so a rename passes the prefix comparison
 * above while silently zeroing that bar or stage on the page. They have to
 * be compared as their own lists. */
function tableIds(path, constName) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) return null;
  const block = source.slice(start, source.indexOf("] as const", start));
  return [...block.matchAll(/\{\s*id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

/** `export const NAME = <number or string>;` declarations, so a shared
 * contract that lives on both sides of the boundary cannot hold two
 * different values. */
function exportedConstants(path) {
  const source = readFileSync(path, "utf8");
  const out = new Map();
  for (const [, name, value] of source.matchAll(
    /export const ([A-Z][A-Z0-9_]*)(?::\s*[^=]+)?\s*=\s*("[^"\n]*"|[0-9_]+(?:\s*\*\s*[0-9_]+)*);/g
  )) {
    // Normalise "60 * 60 * 24" style products to their value so a
    // differently-spelled but equal duration is not a false alarm.
    const numeric = /^[0-9_\s*]+$/.test(value)
      ? String(value.split("*").reduce((a, b) => a * Number(b.replace(/_/g, "").trim()), 1))
      : value;
    out.set(name, numeric);
  }
  return out;
}

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
    // Id tables both files declare. These are the field names' variable
    // half - "b:" + id - so they need comparing on their own.
    idTables: ["TIMING_BUCKETS", "TIMING_STAGES"],
  },
  {
    name: "quality counters",
    writer: join(REPO, "worker", "src", "qualityStats.ts"),
    reader: join(REPO, "frontend", "lib", "qualityStats.ts"),
    // The reader legitimately spells out every check id to label it; the
    // writer gets them from the QualityCheckId type instead. Those are
    // verified against the union separately below.
    readerOnlyAllowed: checkIds,
    idTables: [],
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

  // Ids, in order. Order matters as well as membership: the panel treats
  // the first two buckets as "met the target", so reordering them on one
  // side alone would report the wrong number with every id still present.
  for (const table of pair.idTables) {
    const writerIds = tableIds(pair.writer, table);
    const readerIds = tableIds(pair.reader, table);
    if (writerIds === null || readerIds === null) {
      problems.push(`${pair.name}: ${table} is missing from one side`);
      continue;
    }
    if (writerIds.join(",") !== readerIds.join(",")) {
      problems.push(
        `${pair.name}: ${table} ids differ - worker [${writerIds.join(", ")}] vs app [${readerIds.join(", ")}]`
      );
    }
  }

  // Constants declared on both sides must hold the same value. The target
  // is the one that matters here: the worker buckets against it and the
  // page labels a tile with it, so two different 30s would put a number
  // under a heading that contradicts it.
  const writerConsts = exportedConstants(pair.writer);
  const readerConsts = exportedConstants(pair.reader);
  for (const [name, value] of writerConsts) {
    if (!readerConsts.has(name)) continue;
    if (readerConsts.get(name) !== value) {
      problems.push(
        `${pair.name}: ${name} is ${value} in the worker but ${readerConsts.get(name)} in the app`
      );
    }
  }
}

// The heartbeat contract, which lives in the jobs.ts mirrors rather than a
// stats file. Worth the same guard for a sharper reason: the key now gates
// a public 503 on /api/health, so a one-sided rename does not merely blank
// a panel, it reports the product as down forever.
{
  const writerConsts = exportedConstants(join(REPO, "worker", "src", "jobs.ts"));
  const readerConsts = exportedConstants(join(REPO, "frontend", "lib", "jobs.ts"));
  const required = [
    "JOBS_QUEUE_KEY",
    "JOB_TTL_SECONDS",
    "WORKER_HEARTBEAT_KEY",
    "WORKER_HEARTBEAT_TTL_SECONDS",
    "WORKER_HEARTBEAT_INTERVAL_MS",
    // The trip-length cap. Both sides enforce it - the app rejects an
    // over-long brief at the door, the worker refuses it again before its
    // first model call - and the whole point of two enforcement points is
    // that they agree. Raised on one side only, the app would accept briefs
    // the worker then refuses (a 202 followed by a failed job the traveler
    // paid a quota slot for); lowered on one side only, the worker would
    // refuse trips the form happily offers.
    "MAX_TRIP_DAYS",
  ];
  for (const name of required) {
    const a = writerConsts.get(name);
    const b = readerConsts.get(name);
    if (a === undefined || b === undefined) {
      problems.push(`jobs.ts mirrors: ${name} is missing from ${a === undefined ? "the worker" : "the app"}`);
    } else if (a !== b) {
      problems.push(`jobs.ts mirrors: ${name} is ${a} in the worker but ${b} in the app`);
    }
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

// The heartbeat's env-var list, which is the third hand-copied list across
// this same deploy boundary and the one with the loudest failure. The
// worker reports the names it can see; the frontend decides what each one
// means. Add a name to only the frontend's list and /admin/health prints
// it MISSING forever on a perfectly healthy worker, and - because a
// "required" one drops the verdict to DOWN - the whole page reads as
// broken. Add it to only the worker's and it is collected and never shown.
{
  const workerSource = readFileSync(join(REPO, "worker", "src", "index.ts"), "utf8");
  const start = workerSource.indexOf("const HEARTBEAT_ENV_NAMES");
  const workerNames =
    start === -1
      ? null
      : new Set(
          [...workerSource.slice(start, workerSource.indexOf("] as const", start)).matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map(
            (m) => m[1]
          )
        );

  const healthSource = readFileSync(join(REPO, "frontend", "lib", "health.ts"), "utf8");
  const workerEnvStart = healthSource.indexOf("export const WORKER_ENV");
  const frontendNames =
    workerEnvStart === -1
      ? null
      : new Set(
          [...healthSource.slice(workerEnvStart, healthSource.indexOf("\n];", workerEnvStart)).matchAll(/name:\s*"([A-Z][A-Z0-9_]*)"/g)].map(
            (m) => m[1]
          )
        );

  if (!workerNames || !frontendNames) {
    problems.push("heartbeat env list: could not find HEARTBEAT_ENV_NAMES or WORKER_ENV to compare");
  } else {
    // Sets, not sequences: the worker filters by name and the frontend's
    // order is only display order.
    const workerOnly = [...workerNames].filter((n) => !frontendNames.has(n)).sort();
    const frontendOnly = [...frontendNames].filter((n) => !workerNames.has(n)).sort();
    if (workerOnly.length > 0) {
      problems.push(
        `heartbeat env list: the worker reports ${workerOnly.join(", ")}, which /admin/health never shows`
      );
    }
    if (frontendOnly.length > 0) {
      problems.push(
        `heartbeat env list: /admin/health expects ${frontendOnly.join(", ")}, which the worker never reports ` +
          `(they would read MISSING on a healthy worker)`
      );
    }
  }
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
    `(${PAIRS.length} counter sets, ${checkIds.size} quality checks all labelled, ` +
    `bucket/stage ids, the heartbeat contract and its env list in step).`
);
