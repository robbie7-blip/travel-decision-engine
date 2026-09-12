// The two translation dictionaries, checked for the things the type system
// cannot see.
//
// What it CAN see is already covered and not repeated here: Dictionary is a
// strict interface with required fields and both `en` and `bg` are typed to
// it, so a missing Bulgarian key is a compile error and `npx tsc --noEmit`
// in CI is the guard. That is the right mechanism, and this script
// deliberately does not duplicate it.
//
// Three things slip past it, all of which render as visible nonsense rather
// than as an error:
//
//   PLACEHOLDER DRIFT. Strings carry {count}, {destination}, {month} and
//   friends, substituted by .replace() at the call site. A Bulgarian string
//   that omits one, or misspells it, silently loses the substitution - the
//   number or city name simply never appears, and the sentence reads as if
//   it had been written that way on purpose. Nothing throws.
//
//   ARRAY-LENGTH DRIFT. Several entries are arrays rendered by index or
//   mapped over (the starter questions, the feature lists). A Bulgarian
//   array one entry short drops a feature from the pricing page for
//   Bulgarian visitors only.
//
//   A PLACEHOLDER NOBODY REPLACES. A {token} in a dictionary string with no
//   corresponding .replace() anywhere renders literally: the visitor reads
//   "Plan: {plan}". This found two such strings - account.signedInAs and
//   account.currentPlan - which turned out to be entirely unreferenced, so
//   they were deleted rather than wired up. The rule is what stops the next
//   one being wired up without its substitution.
//
// Empty strings are checked too: an empty entry is a blank label, which
// reads as a layout bug rather than as a missing translation.
//
// Written in TypeScript and run with tsx (unlike the other check:* scripts,
// which are plain .mjs) for one reason: it has to IMPORT lib/i18n.ts and
// walk the real objects. Parsing 1,591 lines of TypeScript as text to infer
// the same thing would be guessing at the data this can simply read.
//
// Run: npm run check:i18n

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { TRANSLATIONS } from "../lib/i18n";

const ROOT = resolve(import.meta.dirname, "..");

const TOKEN = /\{[a-zA-Z0-9_]+\}/g;
const tokensIn = (s: string): string[] => [...s.matchAll(TOKEN)].map((m) => m[0]);

const problems: string[] = [];

/** Walks en and bg together, comparing shape and placeholders. */
function compare(en: unknown, bg: unknown, path: string): void {
  if (typeof en === "string") {
    if (typeof bg !== "string") {
      problems.push(`${path}: en is a string, bg is ${typeof bg}`);
      return;
    }
    if (en.trim() === "") problems.push(`${path}: the English string is empty`);
    if (bg.trim() === "") problems.push(`${path}: the Bulgarian string is empty`);

    const a = [...new Set(tokensIn(en))].sort();
    const b = [...new Set(tokensIn(bg))].sort();
    if (a.join(",") !== b.join(",")) {
      problems.push(
        `${path}: placeholders differ\n` +
          `      en [${a.join(" ") || "none"}]: "${en.slice(0, 80)}"\n` +
          `      bg [${b.join(" ") || "none"}]: "${bg.slice(0, 80)}"`
      );
    }
    return;
  }

  if (Array.isArray(en)) {
    if (!Array.isArray(bg)) {
      problems.push(`${path}: en is an array, bg is ${typeof bg}`);
      return;
    }
    if (en.length !== bg.length) {
      problems.push(`${path}: en has ${en.length} entries, bg has ${bg.length}`);
    }
    en.forEach((v, i) => {
      if (i < bg.length) compare(v, bg[i], `${path}[${i}]`);
    });
    return;
  }

  if (en && typeof en === "object") {
    const e = en as Record<string, unknown>;
    const b = (bg ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      compare(e[key], b[key], path ? `${path}.${key}` : key);
    }
  }
}

compare(TRANSLATIONS.en, TRANSLATIONS.bg, "");

/** Every placeholder present anywhere in either dictionary. */
const declared = new Set<string>();
const collect = (v: unknown): void => {
  if (typeof v === "string") {
    tokensIn(v).forEach((t) => declared.add(t));
    return;
  }
  if (Array.isArray(v)) {
    v.forEach(collect);
    return;
  }
  if (v && typeof v === "object") Object.values(v).forEach(collect);
};
collect(TRANSLATIONS);

/** Every .ts/.tsx file in the app, except the dictionary itself and tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    const full = resolve(ROOT, rel);
    if (statSync(full).isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.") && rel !== "lib/i18n.ts") out.push(full);
  }
  return out;
}

const code = ["app", "components", "lib"]
  .flatMap((dir) => sourceFiles(dir))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

// Substitution happens as either .replace("{token}", ...) or
// .replace(/\{token\}/g, ...), so both spellings count.
const orphans = [...declared].filter((token) => {
  const bare = token.slice(1, -1);
  return !code.includes(`"${token}"`) && !code.includes(`'${token}'`) && !code.includes(`\\{${bare}\\}`);
});

if (orphans.length > 0) {
  problems.push(
    `these placeholders appear in a translation string but nothing replaces them,\n` +
      `      so they render literally to the visitor: ${orphans.join(", ")}`
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} translation problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

console.log(
  `en and bg agree: same placeholders, same array lengths, no empty strings, ` +
    `all ${declared.size} placeholders replaced somewhere.`
);
