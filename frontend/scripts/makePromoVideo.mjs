// The promo video: half a minute of the product, actually running.
//
// WHAT IT IS AND IS NOT. Every frame is the real site, driven the way a
// visitor drives it, recorded off a real browser. Nothing is mocked up,
// nothing is generated, and there is no stock footage of a traveller in a
// street somewhere - which is the obvious way to make a travel promo and
// the wrong one here, on a site whose argument is that it does not
// pretend. The share card has no photograph for the same reason.
//
// THE ONE SHOT THAT IS MISSING, AND WHY. There is no itinerary in it.
// lib/demoTrip.ts refuses to fabricate one on principle - "this app's
// whole pitch is grounded, not fabricated, so a fake demo would undermine
// the one claim it exists to prove" - so the only honest itinerary to
// film is one that was really generated, which means a real trip in
// Redis. A recording made here has neither the credentials nor the right
// to spend anyone's money generating one. So the video shows the asking
// and the deciding and stops short of the answer, and the gap is
// deliberate rather than overlooked: set a demo trip (/admin/demo-trip)
// and this can film /trip/<id> as shot five.
//
// HOW IT RUNS. `next start` on a random port (scripts/lib/devServer.mjs),
// Chromium frame by frame on a clock this process owns
// (scripts/lib/recorder.mjs), sharp for the dissolves, ffmpeg for H.264.
// Frames are piped straight into ffmpeg rather than written out: 700
// frames of 1080p is a gigabyte on a disk allowance that is not that
// large.
//
//   npm run build && node scripts/makePromoVideo.mjs
//
// Needs ffmpeg on PATH. It is NOT a dependency of this package - like
// scripts/makeLaunchScreens.mjs and its playwright-core, this is a
// one-off asset generator and the package should not grow for it.
// Debian/Ubuntu: apt-get install ffmpeg. macOS: brew install ffmpeg.
//
// Output: public/clips/promo.mp4

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { findChrome, startNextServer } from "./lib/devServer.mjs";
import { openRecorder, SWIFTSHADER_ARGS } from "./lib/recorder.mjs";

const sharp = createRequire(import.meta.url)("sharp");

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const OUT_DIR = join(FRONTEND, "public", "clips");
const OUT = join(OUT_DIR, "promo.mp4");

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 25;
const STEP_MS = Math.round(1000 / FPS);

/** The cross-fade between shots, in frames.
 *
 * Short on purpose. A long dissolve is the grammar of a holiday advert;
 * five frames reads as an edit rather than as an effect, and the cards at
 * either end are the only places anything fades at all. */
const DISSOLVE = 5;

const seconds = (s) => Math.round(s * FPS);

/** The shots, in order.
 *
 * `warmMs` runs the page forward without filming it, which is how a shot
 * can start at an interesting moment instead of at whatever the page
 * looks like on arrival. The hero uses it to land inside the gallery's
 * own six-second rotation, so a photograph changes on camera rather than
 * the shot holding one still frame for three seconds.
 */
const SHOTS = [
  {
    name: "title",
    kind: "card",
    path: "/opengraph-image",
    frames: seconds(2.4),
  },
  {
    name: "hero",
    path: "/",
    frames: seconds(2.8),
    // The gallery rotates every 6s with a 900ms fade. Arriving 1.2s
    // before a switch puts the fade on camera.
    warmMs: 4800,
  },
  {
    name: "form",
    path: "/",
    frames: seconds(5.4),
    // Scroll to the form, then type a destination into it - the one
    // piece of this the viewer is being asked to do themselves.
    prepare: `(() => {
      const form = document.querySelector(".trip-form-grid");
      if (!form) return "no .trip-form-grid on the page";
      window.scrollTo(0, form.getBoundingClientRect().top + window.scrollY - 150);
      const input = form.querySelector("input");
      if (!input) return "no input inside .trip-form-grid";
      input.focus();
      return null;
    })()`,
    // Deliberately NOT submitted. Submitting fires a real generation,
    // which costs real money on someone's account, and a promo that
    // bills its owner every time it is re-cut is a bad promo.
    type: { text: "Rome", startFrame: 14, framesPerChar: 5 },
  },
  {
    name: "why",
    path: "/why-decide",
    frames: seconds(4.8),
    // Up past "It's not a chatbot. It's a decision." into the comparison
    // beneath it, which makes the argument in the product's own words.
    scroll: { from: 0, to: 700 },
  },
  {
    name: "dart",
    path: "/decide-for-me",
    frames: seconds(5.6),
    webgl: true,
    settleMs: 3000,
    click: { selector: ".spin-button", frame: 12 },
  },
  {
    name: "ask",
    path: "/ask",
    frames: seconds(2.6),
    scroll: { from: 0, to: 120 },
  },
  {
    name: "guides",
    path: "/destinations",
    frames: seconds(2.8),
    scroll: { from: 60, to: 520 },
  },
  {
    name: "end",
    kind: "card",
    path: "/opengraph-image",
    frames: seconds(2.6),
  },
];

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  fail([
    "No Chrome or Chromium binary found, and every frame of this is a",
    "recording of a real browser.",
    "",
    "Set CHROME_PATH to one, or install Chromium.",
  ]);
}

if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  fail([
    "No ffmpeg on PATH, and the frames have to be encoded by something.",
    "",
    "  Debian/Ubuntu: apt-get install ffmpeg",
    "  macOS:         brew install ffmpeg",
    "",
    "It is deliberately not a dependency of this package - see the header.",
  ]);
}

if (!existsSync(join(FRONTEND, ".next"))) {
  fail(["No .next directory, so there is no site to film.", "", "  npm run build && node scripts/makePromoVideo.mjs"]);
}

let stopServer = null;
let recorder = null;
const cleanUp = () => {
  try {
    recorder?.close();
  } catch {
    /* already gone */
  }
  stopServer?.();
};
process.on("exit", cleanUp);
process.on("SIGINT", () => {
  cleanUp();
  process.exit(130);
});

const started = await startNextServer({ cwd: FRONTEND, probePath: "/" });
stopServer = started.stop;
if (!started.ok) {
  fail([
    `next start never answered on port ${started.port}, so nothing was filmed.`,
    "",
    started.log.trim() || "(the server printed nothing)",
  ]);
}
const origin = `http://127.0.0.1:${started.port}`;

// ---------------------------------------------------------------- encoder

mkdirSync(OUT_DIR, { recursive: true });

/** H.264 at a constant quality, from JPEGs on stdin.
 *
 * yuv420p because anything else will not play in a browser or on a
 * phone, and faststart so the file begins playing before it has all
 * arrived - this is for posting, not for archiving. */
const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(FPS),
    "-i", "-",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "20",
    "-preset", "medium",
    "-movflags", "+faststart",
    OUT,
  ],
  { stdio: ["pipe", "ignore", "pipe"] }
);
let ffmpegLog = "";
ffmpeg.stderr.on("data", (chunk) => {
  ffmpegLog += chunk;
});
const ffmpegDone = new Promise((resolve) => ffmpeg.on("close", resolve));

/** Write one frame, respecting backpressure.
 *
 * Without the drain wait, node buffers every frame ffmpeg has not read
 * yet, which for 700 frames of 1080p is the whole video in memory. */
let written = 0;
async function writeFrame(jpeg) {
  written++;
  if (!ffmpeg.stdin.write(jpeg)) {
    await new Promise((done) => ffmpeg.stdin.once("drain", done));
  }
}

/** The previous shot's last frame, so the next one can fade up from it. */
let tail = null;

async function emit(frames) {
  for (let i = 0; i < frames.length; i++) {
    let frame = frames[i];
    if (tail && i < DISSOLVE) {
      // The outgoing frame laid over the incoming one, thinning out.
      const opacity = 1 - (i + 1) / (DISSOLVE + 1);
      const over = await sharp(tail).ensureAlpha(opacity).png().toBuffer();
      frame = await sharp(frame).composite([{ input: over, blend: "over" }]).jpeg({ quality: 95 }).toBuffer();
    }
    await writeFrame(frame);
  }
  tail = frames[frames.length - 1];
}

// ------------------------------------------------------------------ shots

/** A still card, held: the share image, fitted to the frame.
 *
 * The share card is already a designed title card - the mark, the
 * wordmark, the headline and the green rule - so the video opens and
 * closes on the same artwork the site hands to every link preview,
 * instead of a second version of it that could drift. It is 1200x630,
 * very slightly wider than 16:9, so it fits inside the frame and the
 * remainder is filled with the card's own background rather than black
 * bars. */
async function card(path, frames) {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());

  // The card's own background, read off its top-left corner rather than
  // hardcoded, so a change to the card cannot leave a strip of the wrong
  // cream down the top and bottom of the video.
  const corner = await sharp(source).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  const background = { r: corner[0], g: corner[1], b: corner[2] };

  const fitted = await sharp(source)
    .resize({ width: WIDTH, height: HEIGHT, fit: "contain", background })
    .jpeg({ quality: 95 })
    .toBuffer();
  return Array.from({ length: frames }, () => fitted);
}

/** A page, filmed frame by frame. */
async function pageShot(shot) {
  const page = await recorder.newPage({ width: WIDTH, height: HEIGHT, stepMs: STEP_MS });
  try {
    await page.load(`${origin}${shot.path}`, shot.settleMs ?? 2500);

    if (shot.webgl) {
      const canvases = await page.evaluate(`document.querySelectorAll("canvas").length`);
      if (canvases < 1) {
        throw new Error(
          `${shot.path} rendered without a canvas, so this would have filmed the ` +
            `no-WebGL fallback rather than the globe`
        );
      }
    }

    if (shot.prepare) {
      const problem = await page.evaluate(shot.prepare);
      if (problem) throw new Error(`${shot.name}: ${problem}`);
    }

    await page.pauseClock();
    // Run the page on, unfilmed, to reach the moment worth filming.
    if (shot.warmMs) await page.advance(shot.warmMs);

    const frames = [];
    for (let i = 0; i < shot.frames; i++) {
      if (shot.scroll) {
        // Eased rather than linear: a scroll that starts and stops at
        // full speed reads as a jump cut at both ends.
        const t = shot.frames < 2 ? 1 : i / (shot.frames - 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const y = Math.round(shot.scroll.from + (shot.scroll.to - shot.scroll.from) * eased);
        await page.evaluate(`window.scrollTo(0, ${y})`);
      }

      if (shot.type) {
        const { text, startFrame, framesPerChar } = shot.type;
        const index = Math.floor((i - startFrame) / framesPerChar);
        if (i >= startFrame && index < text.length && (i - startFrame) % framesPerChar === 0) {
          await page.send("Input.insertText", { text: text[index] });
        }
      }

      if (shot.click && i === shot.click.frame) {
        await page.evaluate(`document.querySelector(${JSON.stringify(shot.click.selector)}).click()`);
      }

      frames.push(await page.shoot());
      await page.advance();
    }
    return frames;
  } finally {
    await page.close();
  }
}

// ------------------------------------------------------------------- film

recorder = await openRecorder({ chrome, args: SWIFTSHADER_ARGS });

const startedAt = Date.now();
for (const shot of SHOTS) {
  const at = Date.now();
  const frames = shot.kind === "card" ? await card(shot.path, shot.frames) : await pageShot(shot);
  await emit(frames);
  console.log(
    `${shot.name.padEnd(7)} ${String(frames.length).padStart(3)} frames ` +
      `(${(frames.length / FPS).toFixed(1)}s) in ${((Date.now() - at) / 1000).toFixed(0)}s`
  );
}

recorder.close();
recorder = null;
stopServer?.();
stopServer = null;

ffmpeg.stdin.end();
const code = await ffmpegDone;
if (code !== 0) {
  fail([`ffmpeg exited ${code}. Its output:`, "", ffmpegLog.trim().split("\n").slice(-20).join("\n")]);
}

const size = statSync(OUT).size;
console.log(
  `wrote ${OUT.replace(FRONTEND + "/", "")}: ${WIDTH}x${HEIGHT}, ${written} frames at ${FPS}fps ` +
    `(${(written / FPS).toFixed(1)}s), ${(size / 1024 / 1024).toFixed(1)}MB, ` +
    `filmed in ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`
);

// This script drives a browser that spawns its own children and a server
// that is npx's child. An exit code is the only thing it owes anybody.
process.exit(0);
