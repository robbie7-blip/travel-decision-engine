// Renders the generation wait, so the thing a traveller stares at for a
// minute can be looked at rather than imagined.
//
//   TSX_TSCONFIG_PATH=./tsconfig.render.json npx tsx lib/previewLoadingScreen.tsx out.html
//
// Not a test. The wait is the longest uninterrupted moment in the product
// and the one with the least to show for itself, so it is worth seeing.

import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { LoadingScreen } from "../components/LoadingScreen";
import { TRANSLATIONS } from "./i18n";

const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: previewLoadingScreen.tsx <output.html>");
  process.exit(1);
}
const CSS = readFileSync(join(dirname(__filename), "..", "app", "globals.css"), "utf8");

writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>the wait</title><style>${CSS}</style>
<style>body{margin:0;background:#f7f1e2;padding:24px;display:flex;gap:24px;align-items:flex-start}
.w{width:520px}</style>
<div class="w">${renderToStaticMarkup(
    <LoadingScreen
      message="Confirming named venues are still open&hellip;"
      destinations={["Rome"]}
      t={TRANSLATIONS.en}
    />
  )}</div>
<div class="w">${renderToStaticMarkup(<LoadingScreen message="Putting the itinerary together&hellip;" />)}</div>`
);
console.log(`wrote ${OUT}`);
