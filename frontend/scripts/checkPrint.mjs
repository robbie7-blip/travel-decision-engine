// The print stylesheet and the markup it acts on, kept in step.
//
// The itinerary is this product's main artifact - the thing someone waited
// for and will carry around - and there was no print stylesheet at all.
// Printing it produced the screen: a two-row navigation bar, a currency
// switcher, a language toggle, an empty pushback input with its submit
// button, the Ask a Local thread, per-item "helpful / wrong" links, a
// footer of legal links, in colour, with days cut in half wherever the
// page happened to end.
//
// The rules that fixed that are CSS matching class names in TSX, which is
// the most breakable kind of coupling there is: rename a class and nothing
// fails, the page just quietly prints wrong again, and nobody prints often
// enough to notice. So this checks BOTH directions - every print hook used
// in a component has a rule, and every hook the stylesheet names is still
// used by something.
//
// WHY THIS IS STATIC. The real verification was done in Chromium: render
// ItineraryResult to markup, load it with the built CSS, emulate print
// media and read the computed styles. That found a defect a static check
// could not have (see below) and it is the right way to re-check a change
// to these rules. It is not in CI because every other check here runs in
// seconds with no browser and no key, and a headless Chromium download
// per push would be the one thing that makes the suite too slow to run.
//
// It DID catch one thing, though, and it is the reason for the
// base-rule assertion: `.print-only { display: block }` inside @media
// print is not enough on its own. An element with no other display rule
// is visible everywhere else, so the printed colophon rendered at the
// bottom of every trip page on screen. Chromium under emulated screen
// media reported display: block, and now this script refuses a stylesheet
// that has the print rule without the base one.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CSS_PATH = "app/globals.css";
const css = readFileSync(CSS_PATH, "utf8");

/** Every .tsx under components/ and app/, as one blob. The hooks are used
 * across both, and which file uses which is not what this checks. */
function readAllTsx(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) readAllTsx(path, out);
    else if (entry.endsWith(".tsx")) out.push(readFileSync(path, "utf8"));
  }
  return out;
}
const markup = [...readAllTsx("components"), ...readAllTsx("app")].join("\n");

const problems = [];

/** The print block, isolated, so "is this rule inside @media print" is a
 * question this file can actually answer. Brace-matched rather than
 * regexed: the block contains nested rules and an @page. */
function printBlock(source) {
  const start = source.indexOf("@media print {");
  if (start === -1) return null;
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const block = printBlock(css);
if (!block) {
  problems.push(`${CSS_PATH} has no @media print block at all - the itinerary is the product's main artifact and it would print as the screen.`);
}

const outsideBlock = block ? css.replace(block, "") : css;

// --- the hooks, both directions -------------------------------------------

/** Class hooks that exist only so print can act on them. Each one has to
 * appear in the print block AND be used by some component. */
const HOOKS = [
  ["no-print", "hides an element that is an action, a control or navigation"],
  ["print-only", "shows an element that exists only on paper"],
  ["trip-day", "keeps a day from being cut in half by a page break"],
  ["site-header", "takes the whole navigation off the page"],
  ["site-footer", "takes the legal footer off the page"],
  ["print-colophon", "the line saying where a printed copy came from"],
  ["print-url", "the trip's own URL, on the printed copy"],
];

for (const [hook, why] of HOOKS) {
  // `(?![\w-])` rather than a plain \b on the end, because \b treats a
  // hyphen as a boundary - so `\btrip-day\b` happily matched
  // `trip-day-renamed`, and a renamed hook passed this check while
  // printing wrong. Found by renaming one on purpose and watching the
  // guard stay green.
  const hookRe = (prefix) => new RegExp(`${prefix}${hook}(?![\\w-])`);
  if (block && !hookRe("\\.").test(block)) {
    problems.push(`.${hook} is not mentioned in the @media print block, but that is what it is for (${why}).`);
  }
  // Matched inside a className string, so a mention in a comment does not
  // count as a use.
  const used = new RegExp(`className=[^\\n]*["'\`][^"'\`]*\\b${hook}(?![\\w-])`).test(markup);
  if (!used) {
    problems.push(`.${hook} is styled for print but no component puts it in a className - either it was renamed or the rule is dead.`);
  }
}

// --- the rules that carry the weight --------------------------------------

if (block) {
  // The base rule for .print-only, which is the defect Chromium found.
  if (!/\.print-only\s*\{[^}]*display:\s*none/.test(outsideBlock)) {
    problems.push(
      ".print-only has no `display: none` rule OUTSIDE the @media print block. Without it, an element with no other display rule is visible everywhere - the printed colophon renders at the bottom of every trip page on screen."
    );
  }

  // Interactive elements. A button on paper is a lie, and an empty text
  // input reads as a form somebody forgot to fill in.
  for (const selector of ["button", "input", "select", "textarea"]) {
    const hidden = new RegExp(`(^|[,\\s])${selector}\\s*(,|\\{)`, "m").test(block);
    if (!hidden) problems.push(`the print block does not hide <${selector}> - it would print as a dead control.`);
  }

  // A day is a unit. Reading the last two stops of Tuesday on the back of
  // the sheet is exactly the failure paper is meant to avoid.
  if (!/break-inside:\s*avoid/.test(block)) {
    problems.push("the print block sets no `break-inside: avoid`, so a day can be cut in half by a page boundary.");
  }

  // Ink. Every colour in this app is a custom property and nearly every
  // element sets its colour INLINE, which no stylesheet overrides without
  // !important per element - redefining the variables at the root is what
  // reaches all of it, so if that is gone the whole page prints in
  // full-colour brand green.
  if (!/:root\s*\{[^}]*--ink:/.test(block)) {
    problems.push("the print block does not redefine the ink/background custom properties at :root, so the page prints in the screen palette.");
  }

  // Photographs. The cover photo and the day photos are the most
  // ink-expensive thing here and they say what the type already says.
  if (!/(^|[,\s])img\s*(,|\{)/m.test(block)) {
    problems.push("the print block does not hide <img> - a full-bleed cover photograph is a third of a cartridge.");
  }
}

if (problems.length > 0) {
  console.error("Print stylesheet and markup are out of step:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\nTo re-verify for real: render ItineraryResult to markup, load it with .next/static/css, and read computed styles under page.emulateMedia({ media: "print" }) in Chromium.`
  );
  process.exit(1);
}

console.log(
  `Print rules and markup agree (${HOOKS.length} hooks used and styled, interactive elements hidden, days unbroken, palette and photographs handled).`
);
