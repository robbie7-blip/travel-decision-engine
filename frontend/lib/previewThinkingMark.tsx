// Renders the thinking indicator at points through its cycle, so the
// motion can be LOOKED AT rather than reasoned about.
//
//   TSX_TSCONFIG_PATH=./tsconfig.render.json npx tsx lib/previewThinkingMark.tsx out.html
//
// Not a test - it asserts nothing. It exists because a screenshot cannot
// show an animation, and the first version of this file got that wrong in
// a way worth recording: it put the negative animation-delay on a WRAPPER
// DIV, which has no animation of its own. Nothing was frozen, every cell
// rendered the live animation at whatever phase the screenshot caught, and
// the result looked like a component with a missing stroke. Half an hour
// went into the component before the harness turned out to be the problem.
//
// So the delay now goes on the animated elements themselves, per cell, and
// keeps each stroke's own stagger by subtracting it - otherwise all three
// strokes show the same phase and the thing being checked, that the pulse
// runs left, right, middle, is invisible.
//
// The last row is the reduced-motion state, which on this page is the one
// most likely to be wrong: globals.css kills every animation with one
// blanket rule, so whatever the base styles look like is what a reader
// with that preference gets. The base styles have to be the finished mark,
// not a fragment of one.

import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ThinkingMark } from "../components/ThinkingMark";

const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: previewThinkingMark.tsx <output.html>");
  process.exit(1);
}

const HERE = dirname(__filename);
/** The real stylesheet, so this previews what ships rather than a copy
 * that can drift. */
const CSS = readFileSync(join(HERE, "..", "app", "globals.css"), "utf8");

const FRAMES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35];
/** The per-stroke delays in globals.css. Subtracted from each cell's
 * offset so the stagger survives being frozen. */
const STAGGER = [0, 0.12, 0.24];

/** Holds one cell at `seconds` into the cycle. !important because the
 * harness has to win against the stylesheet it is previewing, and a
 * harness that silently loses is the bug described above. */
function freezeRules(cell: string, seconds: number): string {
  const lines = STAGGER.map(
    (stagger, i) =>
      `.${cell} .thinking-mark-pulse-${i + 1}` +
      `{animation-delay:-${(seconds + stagger).toFixed(3)}s!important}`
  );
  lines.push(
    `.${cell} .thinking-mark-dot{animation-delay:-${(seconds + STAGGER[2]).toFixed(3)}s!important}`
  );
  lines.push(
    `.${cell} .thinking-mark-pulse,.${cell} .thinking-mark-dot{animation-play-state:paused!important}`
  );
  return lines.join("\n");
}

function row(size: number, prefix: string): { html: string; css: string } {
  const cells: string[] = [];
  const rules: string[] = [];
  FRAMES.forEach((seconds, i) => {
    const cell = `${prefix}${i}`;
    rules.push(freezeRules(cell, seconds));
    cells.push(
      `<div class="cell ${cell}">${renderToStaticMarkup(<ThinkingMark size={size} />)}` +
        `<em>${seconds.toFixed(2)}s</em></div>`
    );
  });
  return { html: `<div class="strip">${cells.join("")}</div>`, css: rules.join("\n") };
}

const small = row(22, "a");
const large = row(48, "b");

writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>thinking mark</title>
<style>${CSS}</style>
<style>
body{margin:0;background:#f7f1e2;padding:18px;font:12px system-ui;color:var(--ink-dim);
display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.strip{display:flex;gap:10px;align-items:flex-end;background:var(--bg-panel);padding:12px;
border:1px solid var(--line);border-radius:12px}
.cell{display:flex;flex-direction:column;align-items:center;gap:4px}
.cell em{font-style:normal;font-size:9px;color:var(--ink-dim)}
.label{font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.frozen .thinking-mark-pulse,.frozen .thinking-mark-dot{animation:none!important}
.inline{display:flex;align-items:center;gap:8px;background:var(--bg-panel);
padding:12px 14px;border:1px solid var(--line);border-radius:12px;color:var(--ink-dim);font-size:14px}
${small.css}
${large.css}
</style>
<div class="label">one cycle at 22px, the size it renders inline</div>
${small.html}
<div class="label">the same cycle at 48px, to see what the pulse is doing</div>
${large.html}
<div class="label">reduced motion: animation killed, must read as the finished mark</div>
<div class="strip frozen">${[22, 32, 48]
    .map((px) => `<div class="cell">${renderToStaticMarkup(<ThinkingMark size={px} />)}</div>`)
    .join("")}</div>
<div class="label">in place, beside its text</div>
<div class="inline frozen">${renderToStaticMarkup(
    <ThinkingMark size={22} />
  )}<span>Thinking about your trip&hellip;</span></div>`
);
console.log(`wrote ${OUT}`);
