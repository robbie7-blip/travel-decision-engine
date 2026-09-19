// Can a traveler type on a phone without the page zooming in?
//
// iOS Safari zooms the whole page when you focus a text field whose
// font-size is under 16px, and it does not zoom back out. The layout is
// then wider than the viewport and you are panning sideways to finish the
// form. Reported from a real phone: "when trying to type something it
// zooms in and messes up the sizing of the page, looks unprofessional,
// none of the big apps like booking, wizz and rest do that."
//
// They don't, because they all obey the one rule that switches it off:
// 16px. It is not a bug and there is no setting - the zoom is Safari
// deciding the text is too small to type into.
//
// This guard exists because of the fix that looks easier and is wrong.
// `maximum-scale=1` or `user-scalable=no` in the viewport meta also stops
// the zoom, by taking pinch-zoom away from everybody - including the people
// who need it to read anything at all, which is WCAG 2.1 SC 1.4.4 - and
// newer Safari ignores it anyway, so it trades an accessibility failure for
// nothing. It is one line, it appears at the top of every search result for
// this problem, and nothing in the repo would have stopped it.
//
// So two things are checked:
//
//   1. the viewport meta never blocks zooming;
//   2. the 16px floor still exists, applies to text inputs AND textareas,
//      and is inside a touch-device media query with !important - because
//      a sweep found 29 fields between 11px and 15px across 13 files, most
//      of them inline styles that a rule without !important cannot reach.
//
// It deliberately does NOT try to find every under-16px field itself. The
// floor covers them by construction, and a scanner that re-derives the
// list would fail on every new small label in an admin panel while adding
// nothing: the rule either applies to fields or it doesn't.
//
// Run: npm run check:touch-zoom

import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const problems = [];

// --- 1. the viewport must stay zoomable ---------------------------------

/** Every file that could set the viewport meta: the Next.js metadata
 * exports, plus any hand-written <meta> in a layout or page. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|jsx?|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const BLOCKS_ZOOM = [
  // The meta content form.
  /maximum-scale\s*=\s*1/i,
  /user-scalable\s*=\s*no/i,
  // And the Next.js Viewport object form, which is what this app uses.
  /maximumScale\s*:\s*1\b/,
  /userScalable\s*:\s*false/,
];

for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))]) {
  const src = readFileSync(file, "utf8");
  for (const pattern of BLOCKS_ZOOM) {
    if (pattern.test(src)) {
      problems.push(
        `${file.slice(ROOT.length + 1)} blocks pinch-zoom (${pattern}). That stops the iOS ` +
          `typing-zoom by making the page unzoomable for everyone, which fails WCAG 1.4.4 - and ` +
          `newer Safari ignores it anyway. Keep the 16px field floor instead.`
      );
    }
  }
}

// --- 2. the 16px floor must still be there ------------------------------

const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** The body of the first `@media (pointer: coarse)` block, which is where
 * the floor lives - along with the 44px touch targets it belongs with. */
function coarseBlock(source) {
  const at = source.indexOf("@media (pointer: coarse)");
  if (at === -1) return null;
  const open = source.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

const coarse = coarseBlock(css);
if (coarse === null) {
  problems.push(
    "globals.css has no @media (pointer: coarse) block, so the 16px field floor that stops iOS " +
      "zooming the page on focus is gone."
  );
} else {
  // The rule, as its selector and its declaration. Matched loosely on
  // purpose: what matters is that a rule covering inputs and textareas
  // sets 16px with !important somewhere in this block, not how its
  // :not() chain happens to be written today.
  const rules = [...coarse.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const floor = rules.find(([, selector, body]) => {
    const has16 = /font-size:\s*16px\s*!important/.test(body);
    const coversInput = /\binput\b/.test(selector);
    const coversTextarea = /\btextarea\b/.test(selector);
    return has16 && coversInput && coversTextarea;
  });
  if (!floor) {
    const near = rules.filter(([, , body]) => /font-size/.test(body)).length;
    problems.push(
      "globals.css: no rule inside @media (pointer: coarse) sets `font-size: 16px !important` for " +
        `both input and textarea. Without it iOS Safari zooms the page in the moment a traveler ` +
        `taps a field. (${near} rule(s) in that block mention font-size.)`
    );
  }
}

// The two shared sources of the same number, so the form does not change
// size at the breakpoint. Checked as "at least 16", not "exactly", because
// bigger is fine and only smaller triggers the zoom.
const ui = readFileSync(join(ROOT, "components", "ui.tsx"), "utf8");
const inputStyleBlock = ui.slice(ui.indexOf("export const inputStyle"), ui.indexOf("};", ui.indexOf("export const inputStyle")));
const inlineSize = /fontSize:\s*(\d+)/.exec(inputStyleBlock);
if (!inlineSize) {
  problems.push("components/ui.tsx: inputStyle has no fontSize, so every field using it inherits whatever it inherits.");
} else if (Number(inlineSize[1]) < 16) {
  problems.push(
    `components/ui.tsx: inputStyle is ${inlineSize[1]}px. The touch floor would still save it on a ` +
      `phone, but the form would then be one size on a laptop and another on a phone. Use 16.`
  );
}

if (problems.length > 0) {
  console.error("Typing on a phone would zoom the page in.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nThe rule is 16px on any field that takes typed text, and a viewport that stays\n" +
      "zoomable. See the (pointer: coarse) block in app/globals.css."
  );
  process.exit(1);
}

console.log("Phone typing does not zoom the page (16px field floor in place, viewport still zoomable).");
