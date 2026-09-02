// Generates the iOS launch images referenced by the <link
// rel="apple-touch-startup-image"> tags in app/layout.tsx.
//
// Why these exist at all: an installed PWA on iOS does NOT use the web
// manifest's background_color for its launch screen. With no startup
// image declared, iOS paints plain white until the web view has something
// to show - so opening the app flashed white, then cut to our own
// parchment splash. These images make that first frame the parchment
// splash instead, so the launch reads as one continuous screen.
//
// iOS only matches a startup image whose media query names the device's
// exact CSS dimensions and pixel ratio, which is why this is a list of
// specific devices rather than one scalable asset.
//
// This is a one-off asset generator, not part of the build, so
// playwright-core is deliberately not a dependency of this package -
// point NODE_PATH at an install that has it:
//
//   NODE_PATH=/path/to/node_modules node scripts/makeLaunchScreens.mjs
//
// CHROMIUM_PATH overrides the browser binary (see BROWSER below).
// Output: public/launch/*.png, and the device table is exported below so
// layout.tsx generates its links from the same source.

import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved through createRequire rather than a static import: ESM ignores
// NODE_PATH, and this package deliberately doesn't depend on playwright.
// PLAYWRIGHT_CORE can name an absolute path instead.
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_CORE || "playwright-core"
);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "public", "launch");
const BROWSER =
  process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// The device list lives in lib/launchScreens.ts, which the root layout
// also reads to emit the matching <link> tags - one source, so an image
// and its link can never drift apart. Parsed rather than imported because
// that file is TypeScript and this script runs under bare node.
async function devices() {
  const src = await readFile(join(ROOT, "lib", "launchScreens.ts"), "utf8");
  const body = src.slice(src.indexOf("LAUNCH_DEVICES"));
  return [...body.matchAll(/width: (\d+), height: (\d+), ratio: (\d+)/g)].map((m) => ({
    width: Number(m[1]),
    height: Number(m[2]),
    ratio: Number(m[3]),
  }));
}

const launchImageName = (d) => `launch-${d.width}x${d.height}@${d.ratio}x.png`;

// Mirrors components/AppSplash.tsx: same ground, same mark, same wordmark
// at the same size, so the handoff from this image to the real splash is
// invisible.
function page(logoDataUri, fontCss) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss}
html,body{margin:0;height:100%}
body{
  background:#faf8f1;
  display:flex;align-items:center;justify-content:center;
}
.row{display:flex;align-items:center;gap:18px}
img{width:76px;height:76px;display:block}
span{
  font-family:Literata,Georgia,serif;
  font-size:48px;font-weight:600;line-height:1;color:#2c6a4c;
}
</style></head><body><div class="row">
<img src="${logoDataUri}" alt=""><span>decide</span>
</div></body></html>`;
}

async function literataCss() {
  // Inlined as a data: URI so the render doesn't depend on the network
  // resolving mid-screenshot and silently fall back to Georgia.
  const ttf = await readFile(join(ROOT, "lib", "fonts", "literata-600.ttf"));
  return `@font-face{font-family:Literata;font-weight:600;font-style:normal;src:url(data:font/ttf;base64,${ttf.toString(
    "base64"
  )}) format('truetype')}`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const logo = await readFile(join(ROOT, "public", "logo-icon.svg"));
  const logoDataUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;
  const html = page(logoDataUri, await literataCss());

  const browser = await chromium.launch({ executablePath: BROWSER });
  for (const d of await devices()) {
    const p = await browser.newPage({
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: d.ratio,
    });
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(OUT, launchImageName(d)) });
    await p.close();
    console.log("wrote", launchImageName(d), `${d.width * d.ratio}x${d.height * d.ratio}`);
  }
  await browser.close();
}

if (process.argv[1] && process.argv[1].endsWith("makeLaunchScreens.mjs")) {
  await main();
}
