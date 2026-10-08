// Films the real dart throw and writes it out as a looping clip.
//
// WHAT THIS IS FOR. The product needs something to post - a few seconds
// that show what "it decides" means without a paragraph explaining it.
// The throw is already the best answer to that: a globe, a dart, a
// country named out loud.
//
// WHY IT IS A RECORDING AND NOT AN ILLUSTRATION. The obvious alternative
// was a generated clip: a model, a prompt, some footage of a traveller in
// a street. Two things against it. It would be stock footage of a trip
// nobody took, on a site whose whole argument is that it does not
// pretend - the share card has no photograph for the same reason. And it
// could not be checked: a drawn globe is right or wrong on its own terms,
// but a clip claiming to be this product has to actually be this product.
// What is below cannot drift, because it is the page.
//
// HOW IT RUNS. Builds nothing and installs nothing: `next start` on a
// random port (scripts/lib/devServer.mjs, which carries the scars of
// getting that right), Chromium one frame at a time on a clock this
// process owns (scripts/lib/recorder.mjs), and sharp - already here as
// Next's image dependency - to crop and encode. No Playwright, no
// ffmpeg.
//
//   npm run build && node scripts/makeDartClip.mjs
//
// Output: public/clips/dart.webp, and the numbers it prints are worth
// reading - a clip that got too heavy is a clip to shorten, not to ship.
//
// THE GLOBE IS DRAWN IN SOFTWARE HERE. There is no GPU on a CI runner or
// in a container, so this asks for SwiftShader by name, the same way
// checkDartFallback.mjs does for its WebGL run. It renders the same
// scene; it just renders it slowly - which is the whole reason the clock
// is driven rather than watched, because a recording made in real time
// gets a frame a second and no amount of resampling turns that into an
// animation.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { findChrome, startNextServer } from "./lib/devServer.mjs";
import { openRecorder, SWIFTSHADER_ARGS } from "./lib/recorder.mjs";

const sharp = createRequire(import.meta.url)("sharp");

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const OUT_DIR = join(FRONTEND, "public", "clips");
const OUT = join(OUT_DIR, "dart.webp");

/** The shape of the finished clip.
 *
 * FPS is 12 deliberately. The flight is a smooth arc and 24 would be
 * smoother, but this is a WebP that has to be small enough to post and
 * the parchment background compresses far better than twice the frames
 * do. 12 reads as motion; the throw is not an action sequence.
 *
 * WIDTH is what the clip is resized to. 720 is wide enough to read the
 * country name and the plan button at the size a timeline shows a clip.
 */
const FPS = 12;
const WIDTH = 720;
const QUALITY = 58;

/** The beats, in milliseconds.
 *
 * REST is a held moment before the throw, so the first thing the loop
 * shows is a globe sitting still rather than a dart already moving - a
 * clip that opens mid-motion reads as a clip that started late.
 *
 * HOLD is how long the named country stays up at the end. Long enough to
 * read "Plan a trip here", which is the only thing the clip is asking
 * anyone to do.
 *
 * CLOSE is the cross-fade back to the first frame. Without it the loop
 * cuts from a result card to a bare globe, which looks like a dropped
 * frame rather than a repeat.
 */
const REST_MS = 500;
const HOLD_MS = 1700;
const CLOSE_MS = 500;
const LAND_TIMEOUT_MS = 12_000;

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  fail([
    "No Chrome or Chromium binary found, and the clip is a recording of a",
    "real browser, so there is nothing to record without one.",
    "",
    "Set CHROME_PATH to one, or install Chromium.",
  ]);
}

if (!existsSync(join(FRONTEND, ".next"))) {
  fail([
    "No .next directory, so there is no page to film.",
    "",
    "  npm run build && node scripts/makeDartClip.mjs",
  ]);
}

let stopServer = null;
process.on("exit", () => stopServer?.());
process.on("SIGINT", () => {
  stopServer?.();
  process.exit(130);
});

const started = await startNextServer({ cwd: FRONTEND, probePath: "/decide-for-me" });
stopServer = started.stop;
if (!started.ok) {
  fail([
    `next start never answered on port ${started.port}, so nothing was filmed.`,
    "",
    started.log.trim() || "(the server printed nothing)",
  ]);
}

let recorder = null;
process.on("exit", () => {
  try {
    recorder?.close();
  } catch {
    /* already gone */
  }
});

/** THE CLOCK IS DRIVEN, NOT WATCHED.
 *
 * The first version of this recorded a screencast in real time and got
 * eight frames in five and a half seconds. There is no GPU here, so the
 * globe renders in software at something closer to one frame a second,
 * and a recording of that is a slideshow no matter how it is resampled.
 *
 * So the page's clock is taken away from it: scripts/lib/recorder.mjs
 * advances performance.now, timers and requestAnimationFrame by an exact
 * budget and then stops, which means a frame can be captured at precisely
 * 1/FPS of animation regardless of how long the render actually took. The
 * flight that takes seven real seconds here lands at 3300ms of virtual
 * time, which is what it does on a real machine. That file also carries
 * the requestAnimationFrame shim without which this clip silently comes
 * out with no dart in it - the whole subject missing, and nothing to
 * suggest anything went wrong.
 *
 * The cost is wall clock: every step still renders in software, so this
 * takes minutes. It is a one-off generator, and a correct clip slowly is
 * worth more than a broken one quickly.
 */
const STEP_MS = Math.round(1000 / FPS);
const REST_FRAMES = Math.round(REST_MS / STEP_MS);
const HOLD_FRAMES = Math.round(HOLD_MS / STEP_MS);
const MAX_FRAMES = REST_FRAMES + HOLD_FRAMES + Math.ceil(LAND_TIMEOUT_MS / STEP_MS);

recorder = await openRecorder({ chrome, args: SWIFTSHADER_ARGS });
// Wide enough that the region cropped out of it is still bigger than the
// clip, so the resize to WIDTH is a downsample rather than a stretch. A
// 2x device scale factor would be sharper again, and costs four times the
// pixels through a software renderer that is already the slowest thing
// here - the measured difference at 720 wide did not pay for it.
const page = await recorder.newPage({ width: 1180, height: 760, stepMs: STEP_MS });

// The WebGL probe runs in an effect, so the globe does not exist until the
// page has hydrated.
await page.load(`http://127.0.0.1:${started.port}/decide-for-me`, 2500);

const hasCanvas = await page.evaluate(`document.querySelectorAll("canvas").length > 0`);
if (!hasCanvas) {
  fail([
    "The page rendered without a globe canvas, so this would have filmed the",
    "no-WebGL fallback: a button and a result card, no throw to watch.",
    "",
    "SwiftShader is asked for by name above. If it is unavailable, the clip",
    "cannot be made here - but the fallback itself is covered by",
    "scripts/checkDartFallback.mjs, so this is a filming problem, not a bug.",
  ]);
}

/** The region to film: the globe and the space the result appears in.
 *
 * Measured from the page rather than hardcoded, because the layout this
 * crops to was moved twice in one afternoon. Taken as the union of the
 * two grid children so the clip holds the globe on the left and the
 * country name on the right - the throw and its answer in one frame. The
 * explanatory note below them is left out: it is there to be read, not
 * watched.
 */
const region = await page.evaluate(`(() => {
  const stage = document.querySelector(".spin-stage");
  const side = document.querySelector(".spin-side");
  if (!stage || !side) return null;
  const a = stage.getBoundingClientRect();
  const b = side.getBoundingClientRect();
  const pad = 18;
  const left = Math.max(0, Math.min(a.left, b.left) - pad);
  const top = Math.max(0, Math.min(a.top, b.top) - pad);
  const right = Math.max(a.right, b.right) + pad;
  const bottom = Math.max(a.bottom, b.bottom) + pad;
  return { left, top, width: right - left, height: bottom - top };
})()`);
if (!region) {
  fail([".spin-stage or .spin-side is not on the page, so there is nothing to crop to."]);
}

await page.pauseClock();

// Captured through clip rather than cropped afterwards: it is the same
// rectangle either way, and the pixels outside it never have to be
// encoded, read back or thrown away.
const clip = { x: region.left, y: region.top, width: region.width, height: region.height };

const shots = [];
// The rest beat: the globe sitting still, so the loop opens on something
// at rest rather than on a dart already in the air.
for (let i = 0; i < REST_FRAMES; i++) {
  shots.push(await page.shoot(clip));
  await page.advance();
}

await page.evaluate(`document.querySelector(".spin-button").click()`);

let landedFrame = null;
for (let i = 0; i < MAX_FRAMES; i++) {
  shots.push(await page.shoot(clip));
  await page.advance();
  if (landedFrame === null && (await page.evaluate(`!!document.querySelector(".spin-result-card")`))) {
    landedFrame = shots.length;
  }
  if (landedFrame !== null && shots.length - landedFrame >= HOLD_FRAMES) break;
}

if (landedFrame === null) {
  fail([
    `No result card appeared within ${LAND_TIMEOUT_MS / 1000}s of animation after the`,
    "throw, so there is no landing to film. The throw is driven here exactly",
    "as a visitor drives it, so this is a real failure of the page rather",
    "than of the recording: components/GlobeDart.tsx holds the result back",
    "until the camera arrives, with a backstop for when it does not.",
  ]);
}

recorder.close();
recorder = null;
stopServer?.();
stopServer = null;


console.log(
  `captured ${shots.length} frames of ${STEP_MS}ms ` +
    `(landed on frame ${landedFrame}, ${landedFrame * STEP_MS}ms in), ` +
    `region ${Math.round(region.width)}x${Math.round(region.height)}`
);

/** One captured frame, resized to the clip's width, as raw RGB. */
async function prepare(buffer) {
  return sharp(buffer)
    .resize({ width: WIDTH, fit: "inside", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

const prepared = [];
for (const shot of shots) prepared.push(await prepare(shot));
const { width: fw, height: fh } = prepared[0].info;

/** The tail, dissolved back into the opening frame so the loop closes.
 *
 * The overlay is the first frame with a flat alpha, composited over each
 * of the last frames at a rising opacity. sharp wants the overlay as an
 * encoded image rather than raw, hence the round trip through PNG.
 */
const closeFrames = Math.min(Math.round((CLOSE_MS / 1000) * FPS), prepared.length - 2);
const opening = prepared[0].data;
const sequence = prepared.map((p) => p.data);
for (let i = 0; i < closeFrames; i++) {
  const index = sequence.length - closeFrames + i;
  const opacity = (i + 1) / (closeFrames + 1);
  const overlay = await sharp(opening, { raw: { width: fw, height: fh, channels: 3 } })
    .ensureAlpha(opacity)
    .png()
    .toBuffer();
  sequence[index] = await sharp(sequence[index], { raw: { width: fw, height: fh, channels: 3 } })
    .composite([{ input: overlay, blend: "over" }])
    .removeAlpha()
    .raw()
    .toBuffer();
}

const pages = [];
for (const raw of sequence) {
  pages.push(await sharp(raw, { raw: { width: fw, height: fh, channels: 3 } }).png().toBuffer());
}

mkdirSync(OUT_DIR, { recursive: true });
const written = await sharp(pages, { join: { animated: true } })
  .webp({ quality: QUALITY, effort: 6, loop: 0, delay: STEP_MS })
  .toFile(OUT);

console.log(
  `wrote ${OUT.replace(FRONTEND + "/", "")}: ${fw}x${fh}, ${pages.length} frames at ${FPS}fps ` +
    `(${(pages.length / FPS).toFixed(1)}s), ${(written.size / 1024).toFixed(0)}KB`
);

// Everything above is cleaned up, but this script drives a browser that
// spawns its own children and a server that is npx's child. An exit code
// is the only thing it owes anybody.
process.exit(0);
