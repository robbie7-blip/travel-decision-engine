// Fails the build if an em or en dash has crept back into the repo.
//
// The em dash is the most recognisable tell that a piece of text was
// written by a model, and this product asks travelers to read its output as
// advice from a person. Two layers already push against it: the prompts
// tell the model not to write one, and engine/plainDashes.ts strips any
// that survive. This is the third layer, and the only one that covers what
// WE write - the interface copy, the destination guides, the emails.
//
// Zero dependencies, no network, runs in milliseconds. Same principle as
// checkContrast.mjs: the alternative is someone noticing in a screenshot.
//
// Run from frontend/ (npm run check:dashes) - it scans the whole repo, not
// just this package.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", "dist", "coverage"]);
const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".md", ".json",
  ".py", ".yml", ".yaml", ".html", ".svg", ".txt",
]);

// The code that does the stripping obviously has to contain the character
// it strips. These two files are the implementation, not prose.
const ALLOWED_FILES = new Set([
  "worker/src/engine/plainDashes.ts",
  "frontend/scripts/checkDashes.mjs",
  "frontend/app/api/trip-questions/route.ts",
]);

// The two places the character is legitimate in ordinary files, both narrow
// and both deliberate. Anything else is a finding.
const ALLOWED = [
  {
    // The prompts have to be able to name the character they forbid.
    test: (line) => /em dash \("—"\)/.test(line),
    why: 'the prompts\' own "never use an em dash" instruction',
  },
  {
    // Google Places returns opening hours as "Monday: 7:00 AM – 9:00 PM".
    // That string is its data, and the parser is tested against it verbatim.
    test: (line) => /(?:\d|AM|PM)\s*[–—]\s*(?:\d|Sat|Sun|Mon|Tue|Wed|Thu|Fri)/.test(line),
    why: "Google's own opening-hours format",
  },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (EXTS.has(name.slice(name.lastIndexOf(".")))) yield path;
  }
}

const findings = [];
for (const path of files(ROOT)) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (!text.includes("—") && !text.includes("–")) continue;
  if (ALLOWED_FILES.has(relative(ROOT, path))) continue;
  text.split("\n").forEach((line, i) => {
    if (!line.includes("—") && !line.includes("–")) return;
    if (ALLOWED.some((rule) => rule.test(line))) return;
    findings.push(`${relative(ROOT, path)}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (findings.length > 0) {
  console.error(`Found ${findings.length} em/en dash${findings.length === 1 ? "" : "es"}.`);
  console.error("Use a plain hyphen, a comma, or a full stop instead.\n");
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

console.log("No em or en dashes outside the two allowed cases.");
