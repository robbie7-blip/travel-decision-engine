// The mirrored files, checked.
//
// Four files exist twice, once under worker/src/ and once under
// frontend/lib/, and each says in its own header that the two copies are
// "kept byte-identical". Nothing enforced that. The worker writes over
// ioredis and the app reads over the Upstash REST client, so neither can
// import the other's module - copying is the design - but a copy that only
// a comment keeps in step is a copy that drifts.
//
// Drift here is silent and expensive in both directions:
//
//   jobs.ts       the shape of a job and its timings. The worker writes,
//                 the app reads. A field added on one side reads as
//                 undefined on the other, which renders as "no data" -
//                 indistinguishable from a stage that did not run.
//   types.ts      the itinerary contract itself. The app renders what the
//                 worker produced; a divergence is a page that throws on a
//                 field one side guarantees and the other doesn't.
//   costBudget.ts the daily spend cap. The app checks the running total
//                 BEFORE enqueueing and the worker records what was
//                 actually spent AFTER. Two different pricing functions
//                 means the gate and the counter disagree about money, and
//                 the one that matters is whichever is lower.
//   prompt.ts     the prompt text. The frontend builds the same brief block
//                 the worker sends, so a divergence changes what the model
//                 is asked without changing what anyone thinks it was
//                 asked.
//
// The one legitimate divergence is marked in the file itself: a block
// between FRONTEND-ONLY sentinels is stripped from the frontend copy before
// comparing, so a frontend-only export is allowed and everything else is
// not. Adding a sentinel block is a deliberate, visible act; forgetting to
// copy an edit is not.
//
// Run: npm run check:mirrors

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

const PAIRS = [
  ["worker/src/jobs.ts", "frontend/lib/jobs.ts"],
  ["worker/src/types.ts", "frontend/lib/types.ts"],
  ["worker/src/costBudget.ts", "frontend/lib/costBudget.ts"],
  ["worker/src/engine/prompt.ts", "frontend/lib/engine/prompt.ts"],
  ["worker/src/engine/travel.ts", "frontend/lib/engine/travel.ts"],
  ["worker/src/engine/timingAudit.ts", "frontend/lib/engine/timingAudit.ts"],
];

const BEGIN = "// --- FRONTEND-ONLY (not mirrored to the worker) ---";
const END = "// --- END FRONTEND-ONLY ---";

/** Removes every sentinel-delimited frontend-only block, and reports how
 * many were removed so an unclosed sentinel cannot silently swallow the
 * rest of the file. */
function stripFrontendOnly(text, label) {
  const lines = text.split("\n");
  const kept = [];
  let depth = 0;
  let blocks = 0;
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === BEGIN) {
      if (depth > 0) {
        console.error(`${label}:${i + 1} nested FRONTEND-ONLY block`);
        process.exit(1);
      }
      depth = 1;
      blocks++;
      continue;
    }
    if (trimmed === END) {
      if (depth === 0) {
        console.error(`${label}:${i + 1} END FRONTEND-ONLY with no matching begin`);
        process.exit(1);
      }
      depth = 0;
      continue;
    }
    if (depth === 0) kept.push(line);
  }
  if (depth !== 0) {
    console.error(`${label}: a FRONTEND-ONLY block was never closed - everything after it was ignored`);
    process.exit(1);
  }
  return { text: kept.join("\n"), blocks };
}

/** The first line that differs, with enough context to act on. */
function firstDifference(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return {
        line: i + 1,
        worker: la[i] === undefined ? "(end of file)" : la[i],
        frontend: lb[i] === undefined ? "(end of file)" : lb[i],
      };
    }
  }
  return null;
}

let failed = 0;
let allowedBlocks = 0;

for (const [workerPath, frontendPath] of PAIRS) {
  const worker = readFileSync(resolve(ROOT, workerPath), "utf8");
  const frontendRaw = readFileSync(resolve(ROOT, frontendPath), "utf8");
  const { text: frontend, blocks } = stripFrontendOnly(frontendRaw, frontendPath);
  allowedBlocks += blocks;

  if (worker === frontend) continue;

  failed++;
  const diff = firstDifference(worker, frontend);
  console.error(`\nMIRROR DRIFT: ${workerPath} and ${frontendPath} disagree`);
  if (diff) {
    console.error(`  first difference at line ${diff.line} (after stripping frontend-only blocks)`);
    console.error(`    worker:   ${diff.worker}`);
    console.error(`    frontend: ${diff.frontend}`);
  }
  console.error(
    `  fix: copy the edited file over the other, or wrap a deliberately frontend-only\n` +
      `       section in the sentinels:\n         ${BEGIN}\n         ...\n         ${END}`
  );
}

if (failed > 0) {
  console.error(`\n${failed} mirrored file pair(s) have drifted.\n`);
  process.exit(1);
}

console.log(
  `All ${PAIRS.length} mirrored file pairs are byte-identical ` +
    `(${allowedBlocks} declared frontend-only block${allowedBlocks === 1 ? "" : "s"}).`
);
