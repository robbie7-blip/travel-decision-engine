// Literal copies of the CSS custom properties in app/globals.css, for the
// few places that can't read a CSS variable at all: canvas/WebGL contexts
// (components/VisitedGlobe.tsx renders via three.js, not the DOM, so
// `var(--accent-green)` is meaningless there — three.js needs a real color
// string). Every other component in the app should keep using the CSS
// variables directly; only reach for this file from inside a canvas.
//
// Kept intentionally small — just the handful of colors the globe actually
// needs — rather than mirroring the full palette, so it doesn't quietly
// drift out of sync with globals.css by growing unused entries.
export const CANVAS_COLORS = {
  accentGreen: "#3f7a4a", // visited country / --accent-green
  lineStrong: "#cbb98c", // unvisited-but-tracked country / --line-strong
  bgPanelRaised: "#f1e7d2", // untracked territory / --bg-panel-raised
  inkDim: "#8a7d68", // country borders / --ink-dim
  bgPanel: "#fffdf8", // globe surface (flat color, no photo texture) / --bg-panel
  accent1: "#d9643f", // pins / --accent-1
} as const;
