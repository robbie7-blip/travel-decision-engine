// Renders the Ask a Local portraits to a standalone HTML page, so they
// can be LOOKED AT rather than reasoned about.
//
//   TSX_TSCONFIG_PATH=./tsconfig.render.json npx tsx lib/previewVoiceAvatars.tsx out.html
//
// Not a test - it asserts nothing. It exists because every real failure
// these avatars have had was visual and invisible to a green suite: a
// generated drawing that came back as an opaque blob, linework that
// disappeared against the selected card's green, four portraits at four
// different scales. A suite cannot see any of that; a screenshot of this
// page can.
//
// The three strips are the sizes TripQA.tsx actually asks for - 40 in the
// picker, 44 by default, 22 in the summary chip - and the cards below
// them are the selected and unselected states, because `inverted` is the
// one prop whose effect is pure appearance.
//
// It needs the render tsconfig for the same reason lib/renderTrip.test.tsx
// does: the main one sets jsx "preserve" for Next's bundler, which leaves
// a component compiled by tsx with no React in scope.

import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";

import { VOICE_AVATARS } from "../components/LocalVoiceAvatar";

const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: previewVoiceAvatars.tsx <output.html>");
  process.exit(1);
}

const KEYS = ["neighbour", "cook", "night", "family"] as const;

function one(key: (typeof KEYS)[number], size: number, inverted: boolean): string {
  const Avatar = VOICE_AVATARS[key];
  return renderToStaticMarkup(<Avatar size={size} inverted={inverted} />);
}

function strip(size: number): string {
  return `<div class="strip"><em>${size}px</em>${KEYS.map((k) => one(k, size, false)).join("")}</div>`;
}

function card(key: (typeof KEYS)[number], active: boolean): string {
  return (
    `<div class="card"${active ? ' data-active="true"' : ""}>${one(key, 40, active)}` +
    `<span><b>${key}</b><i>a one line blurb about this voice</i></span></div>`
  );
}

// The tokens the real page sets on :root, copied rather than imported:
// globals.css is 2900 lines of which these are the eight that matter here,
// and a preview that pulls in the whole stylesheet stops being a preview
// of the avatars.
writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>voice avatars</title><style>
:root{--brand-teal:#2c6a4c;--brand-coral:#d9643f;--brand-gold:#e8a23f;--brand-purple:#7d5ba6;
--ink:#1b1a17;--ink-soft:#45423c;--ink-dim:#6b665d;--line:#e2ded4;--bg-panel:#fff}
body{margin:0;background:#f7f1e2;padding:20px;font:13px system-ui;color:var(--ink-soft);
display:flex;flex-direction:column;gap:16px;align-items:flex-start}
.strip{display:flex;gap:16px;align-items:center;background:var(--bg-panel);padding:12px 16px;
border-radius:12px;border:1px solid var(--line)}
.strip em{font-style:normal;color:var(--ink-dim);width:34px}
.cards{display:flex;flex-direction:column;gap:8px;width:300px}
.card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);
border-radius:12px;background:var(--bg-panel);color:var(--ink-soft)}
.card[data-active=true]{border-color:var(--brand-teal);background:var(--brand-teal);color:#fff}
.card span{display:flex;flex-direction:column;gap:2px}
.card b{font-size:13px;color:var(--ink)}
.card[data-active=true] b{color:#fff}
.card i{font-size:11px;font-style:normal;color:var(--ink-dim)}
.card[data-active=true] i{color:rgba(255,255,255,.85)}
</style>
${strip(96)}
${strip(44)}
${strip(22)}
<div class="cards">${card("neighbour", true)}${card("cook", false)}${card("night", true)}${card("family", false)}</div>`
);
console.log(`wrote ${OUT}`);
