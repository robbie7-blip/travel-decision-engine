// Asserts that the text colors in globals.css clear WCAG AA against the
// backgrounds they're actually painted on.
//
// This exists for the same reason the worker's test suites do: the only
// detector for "the secondary text is too light to read" used to be
// someone noticing it on a screenshot, and by then it had been live for
// weeks. --ink-dim shipped at 3.28:1 against the raised panel — under the
// 4.5:1 AA needs for body text — and it is the color of nearly every
// label, date, rating and helper line in the product.
//
// No browser, no network, no dependencies: it reads the token values out
// of the stylesheet and does the arithmetic. Runs in milliseconds, costs
// nothing, and fails the build if a token drifts back over the line.
//
// Run: npm run check:contrast

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = join(HERE, "..", "app", "globals.css");

/** WCAG 2.1 minimums. Large text is >=24px, or >=18.66px when bold. */
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

function parseTokens(css) {
  // Only the :root block — component rules may legitimately reference a
  // token in a context this check doesn't model.
  const root = css.slice(css.indexOf(":root"), css.indexOf("\n}"));
  const tokens = {};
  for (const m of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[m[1]] = m[2].trim();
  }
  // Resolve one level of var() aliasing, repeatedly, so --grounded ->
  // var(--brand-teal) -> #1f6f8a.
  for (let pass = 0; pass < 5; pass++) {
    for (const [k, v] of Object.entries(tokens)) {
      const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
      if (alias && tokens[alias[1]]) tokens[k] = tokens[alias[1]];
    }
  }
  return tokens;
}

function hexToRgb(hex) {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every foreground/background pair the UI actually puts on screen.
 *
 * `min` is AA_LARGE only where the color is never used below 24px — the
 * headline is the one such case. Everything else is read at body size
 * somewhere in the product and has to clear AA_NORMAL. */
const PAIRS = [
  { fg: "--ink", bg: "--bg", min: AA_NORMAL, note: "body text on the page" },
  { fg: "--ink", bg: "--bg-panel", min: AA_NORMAL, note: "body text on a panel" },
  { fg: "--ink", bg: "--bg-panel-raised", min: AA_NORMAL, note: "body text on a raised panel" },
  { fg: "--ink-soft", bg: "--bg", min: AA_NORMAL, note: "secondary text on the page" },
  { fg: "--ink-soft", bg: "--bg-panel", min: AA_NORMAL, note: "secondary text on a panel" },
  { fg: "--ink-soft", bg: "--bg-panel-raised", min: AA_NORMAL, note: "nav links in the header" },
  { fg: "--ink-dim", bg: "--bg", min: AA_NORMAL, note: "labels and helper copy on the page" },
  { fg: "--ink-dim", bg: "--bg-panel", min: AA_NORMAL, note: "form labels on a panel" },
  { fg: "--ink-dim", bg: "--bg-panel-raised", min: AA_NORMAL, note: "dates and hours on a raised panel" },
  { fg: "--brand-coral-ink", bg: "--bg", min: AA_NORMAL, note: "coral text on the page" },
  { fg: "--brand-coral-ink", bg: "--bg-panel-raised", min: AA_NORMAL, note: "the header tagline" },
  { fg: "--brand-coral", bg: "--bg", min: AA_LARGE, note: "the hero headline (large only)" },
  { fg: "--grounded", bg: "--bg-panel", min: AA_NORMAL, note: "verified/source links" },
  { fg: "--infeasible", bg: "--bg-panel", min: AA_NORMAL, note: "error text on a panel" },
  { fg: "--infeasible", bg: "--bg", min: AA_NORMAL, note: "error text on the page" },
  { fg: "--accent-green", bg: "--bg-panel", min: AA_NORMAL, note: "success text" },
  { fg: "--brand-teal", bg: "--bg", min: AA_NORMAL, note: "section headings" },
];

const css = await readFile(CSS, "utf8");
const tokens = parseTokens(css);

let failed = 0;
const rows = [];

for (const pair of PAIRS) {
  const fgHex = tokens[pair.fg];
  const bgHex = tokens[pair.bg];
  if (!fgHex || !bgHex) {
    console.error(`  MISSING  ${pair.fg} or ${pair.bg} is not defined in :root`);
    failed++;
    continue;
  }
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) {
    console.error(`  UNPARSED ${pair.fg}=${fgHex} / ${pair.bg}=${bgHex}`);
    failed++;
    continue;
  }
  const ratio = contrast(fg, bg);
  const ok = ratio >= pair.min;
  if (!ok) failed++;
  rows.push(
    `  ${ok ? "ok  " : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (needs ${pair.min})  ` +
      `${pair.fg} on ${pair.bg} — ${pair.note}`
  );
}

console.log("contrast — text colors against the backgrounds they're painted on\n");
console.log(rows.join("\n"));

if (failed > 0) {
  console.error(
    `\n${failed} pair(s) below the WCAG AA minimum.\n` +
      `Darken the foreground token in app/globals.css until it clears — don't lower the\n` +
      `threshold here. If a color is genuinely only ever used above 24px, move that pair\n` +
      `to AA_LARGE and say so in the note.`
  );
  process.exit(1);
}

console.log(`\nAll ${PAIRS.length} pairs clear WCAG AA.`);
