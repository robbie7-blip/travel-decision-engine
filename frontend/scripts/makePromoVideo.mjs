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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** Where filmed frames are kept between runs.
 *
 * Under .next, which is already ignored by git and already understood to
 * be disposable. It exists because the dart shot takes nine minutes of
 * software WebGL and the edit around it was re-cut six times: without a
 * cache, every change to a dissolve costs another nine minutes of
 * redrawing a globe that did not change.
 *
 * PROMO_CACHE=use reuses whatever is there. PROMO_CACHE=refresh throws it
 * away and films again. The default films and writes, so an ordinary run
 * is always a real recording. */
const CACHE_DIR = join(FRONTEND, ".next", "cache", "promo-frames");
const CACHE_MODE = process.env.PROMO_CACHE ?? "";

/** What the cached frames of a shot depend on.
 *
 * KEYED ON THE SPEC, not just the name, and that distinction is the
 * difference between a cache and a trap. Keyed on the name alone, moving
 * the dart's scroll or changing a shot's length would quietly reuse the
 * frames filmed before the change - a cut that is wrong in exactly the
 * way nothing in the output would reveal, which has already happened
 * twice in this script's short life by other means.
 *
 * Only the fields that affect what the camera sees are in here. `motion`
 * and `dissolve` are applied after filming, so changing them re-cuts
 * from the same frames, which is the entire point of keeping them. */
function captureKey(shot) {
  const { name, motion, dissolve, ...capture } = shot;
  void name;
  void motion;
  void dissolve;
  return JSON.stringify(capture);
}

function cachedFrames(shot) {
  if (CACHE_MODE !== "use") return null;
  const dir = join(CACHE_DIR, shot.name);
  const keyFile = join(dir, "capture.json");
  if (!existsSync(keyFile) || readFileSync(keyFile, "utf8") !== captureKey(shot)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  if (files.length === 0) return null;
  return files.map((f) => readFileSync(join(dir, f)));
}

function cacheFrames(shot, frames) {
  const dir = join(CACHE_DIR, shot.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  frames.forEach((frame, i) => writeFileSync(join(dir, String(i).padStart(4, "0") + ".jpg"), frame));
  writeFileSync(join(dir, "capture.json"), captureKey(shot));
}

const WIDTH = 1920;
const HEIGHT = 1080;

/** FILMED NARROW AND SCALED UP, which is the whole difference between
 * the first cut and this one.
 *
 * The first cut was filmed at a 1920-wide CSS viewport, so every shot
 * was a full desktop page and all the type came out tiny. /why-decide
 * makes the best argument in the product - "Picks one. That's the entire
 * point of the product." - and it was unreadable at video scale.
 *
 * So the page is given a 1280 viewport and a 1.5x device scale factor
 * instead. The output is the same 1920x1080, but the site lays itself
 * out for a narrower window and every word renders half again as large.
 * It is the real responsive layout, not a crop or an upscale. */
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const DSF = WIDTH / VIEWPORT_WIDTH;

const FPS = 25;
const STEP_MS = Math.round(1000 / FPS);

/** The cross-fade between shots, in frames.
 *
 * Short on purpose. A long dissolve is the grammar of a holiday advert;
 * five frames reads as an edit rather than as an effect, and the cards at
 * either end are the only places anything fades at all. */
const DISSOLVE = 5;

/** A slow push in or out, applied after filming.
 *
 * WHY IT IS HERE AT ALL. The first cuts were, fairly, called screen
 * recordings: a page, a scroll, a cut, repeat. A reel of static screens
 * reads as documentation however legible it is. A frame that is always
 * very slightly moving reads as film, and costs nothing true - it is the
 * same pixels, just a window travelling across them.
 *
 * Kept to 5% because it is doing the work of a held breath, not of an
 * effect, and because the window is cropped out of a 1920x1080 frame and
 * scaled back up: at 1.05 that is invisible, and at 1.2 it would not be.
 *
 * `from`/`to` are the zoom at the first and last frame. Cards settle
 * (1.04 -> 1.0) so the type arrives and stops; page shots push in
 * (1.0 -> 1.05) so they are never quite still.
 */
async function applyMotion(frame, motion, t, size) {
  if (!motion) return frame;
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const zoom = motion.from + (motion.to - motion.from) * eased;
  if (Math.abs(zoom - 1) < 0.0005) return frame;
  const width = Math.round(size.width / zoom);
  const height = Math.round(size.height / zoom);
  const left = Math.round((size.width - width) / 2);
  // Anchored at the top for shots whose subject is the headline, so a
  // push in does not crawl away from the words.
  const top = motion.anchor === "top" ? 0 : Math.round((size.height - height) / 2);
  return sharp(frame)
    .extract({ left, top, width, height })
    .resize({ width: size.width, height: size.height, kernel: "lanczos3" })
    .jpeg({ quality: 95 })
    .toBuffer();
}

const seconds = (s) => Math.round(s * FPS);

/** The shots, in order.
 *
 * THE CLOCK IS ONLY TAKEN AWAY WHERE THE PAGE ITSELF MOVES, which is
 * the dart and nothing else. Stepping a paused clock is the only way to
 * film an animation the page is running - the throw takes four seconds a
 * frame to draw in software, and real time would get one frame a second.
 * But a paused clock is also what stops the compositor producing frames,
 * and a capture with no frame to take waits for one: intermittently,
 * unpredictably, for minutes. One run stalled 39 of 70 frames on the
 * hero; the same shot then captured 24 frames at 180ms without
 * complaint.
 *
 * In every other shot the only thing moving is a scroll or some typing
 * that this script is doing itself. Those need no clock control at all:
 * set the scroll, take the frame, set the next one. The page is never
 * asked to animate, so nothing has to be stepped, and the compositor
 * keeps painting normally. The spacing between captures in real time
 * does not matter - what makes the motion smooth is the size of each
 * scroll step, not the wall clock between them.
 *
 * Which also rules the hero's gallery fade out, deliberately. Filming a
 * 900ms crossfade in real time at 180ms a frame would play it back five
 * times too fast. The hero gets a slow drift down the page instead:
 * motion this script owns, rather than motion it has to chase.
 */
const SHOTS = [
  {
    name: "title",
    kind: "card",
    path: "/opengraph-image",
    frames: seconds(2.6),
    // Settles rather than pushes: the type arrives and comes to rest.
    motion: { from: 1.045, to: 1.0 },
  },
  {
    name: "hero",
    path: "/",
    frames: seconds(2.8),
    // A slow drift down from the headline, rather than waiting on the
    // gallery's own crossfade - see the note above on why the page's
    // animations are not filmable outside the dart.
    scroll: { from: 0, to: 150 },
    motion: { from: 1.0, to: 1.04, anchor: "top" },
    // A longer fade out of the title card than the cuts between pages.
    dissolve: 10,
  },
  {
    name: "form",
    path: "/",
    // Was 5.4s, which was a fifth of the video spent holding on a grid
    // of empty fields after the typing had finished. The typing is the
    // interesting part; it does not need four seconds of aftermath.
    frames: seconds(3.2),
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
    type: { text: "Rome", startFrame: 8, framesPerChar: 4 },
    motion: { from: 1.0, to: 1.035, anchor: "top" },
  },
  {
    name: "why",
    path: "/why-decide",
    frames: seconds(4.8),
    // Up past "It's not a chatbot. It's a decision." into the comparison
    // beneath it, which makes the argument in the product's own words.
    // Re-measured for the narrower viewport: the page is 1483 tall here,
    // and 620 puts the last comparison row on screen at the end.
    scroll: { from: 40, to: 620 },
    motion: { from: 1.02, to: 1.0, anchor: "top" },
  },
  {
    name: "dart",
    path: "/decide-for-me",
    frames: seconds(5.6),
    webgl: true,
    // The one shot whose motion belongs to the page.
    virtualClock: true,
    // WHERE THE DART LANDS, CHOSEN RATHER THAN ROLLED.
    //
    // throwDart takes its random source as a parameter defaulting to
    // Math.random, so fixing the first number it draws fixes the country
    // and nothing else - the point inside that country is still sampled
    // the way it always is. No product code is touched, and the throw
    // itself is the throw.
    //
    // Picking a take is what filming is, and the first two cuts made the
    // case for picking: Tonga put the camera in open ocean, and Russia
    // was asked about by name. Japan has a guide behind it, so the
    // result card comes up with the Tokyo photograph, "Plan a trip here"
    // and a link to the guide, instead of a country name on its own.
    // Nineteen of the 197 countries have that, and a reel should show
    // the product at its best rather than at its median.
    landOn: { code: "JP", index: 85, of: 197 },
    settleMs: 3000,
    click: { selector: ".spin-button", frame: 12 },
    // FRAMED BY MEASUREMENT, NOT BY EYE. At a 1280x720 viewport the
    // stage runs 491-937 down the page and the result card 744-1131,
    // while the window is 720 tall: at the top of the page the globe is
    // half below the fold and the card is not on screen at all. The
    // first Japan take was filmed that way - a lot of cream, a cut-off
    // globe, and the payoff invisible.
    //
    // So the shot travels: it opens on the heading with the globe
    // arriving, and ends framed on the globe beside the card, which for
    // a country with a guide carries the photograph, the city and the
    // link to it.
    scroll: { from: 0, to: 430 },
  },
  {
    name: "ask",
    path: "/ask",
    frames: seconds(2.6),
    scroll: { from: 0, to: 150 },
    motion: { from: 1.0, to: 1.04 },
  },
  {
    name: "guides",
    path: "/destinations",
    frames: seconds(2.8),
    // A slow pan down the grid of real cities, each with a real
    // photograph and a real guide behind it.
    scroll: { from: 180, to: 640 },
    motion: { from: 1.04, to: 1.0 },
  },
  {
    name: "end",
    kind: "card",
    path: "/opengraph-image",
    frames: seconds(2.8),
    motion: { from: 1.0, to: 1.035 },
    // The longest dissolve in the cut, so the reel resolves onto the
    // wordmark instead of cutting to it.
    dissolve: 12,
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

async function emit(frames, shot) {
  const dissolve = shot?.dissolve ?? DISSOLVE;
  for (let i = 0; i < frames.length; i++) {
    let frame = await applyMotion(
      frames[i],
      shot?.motion,
      frames.length < 2 ? 1 : i / (frames.length - 1),
      { width: WIDTH, height: HEIGHT }
    );
    if (tail && i < dissolve) {
      // The outgoing frame laid over the incoming one, thinning out.
      const opacity = 1 - (i + 1) / (dissolve + 1);
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
  // Said out loud, step by step, because this script has twice sat
  // silent on a single stalled call and "which line is it on" was the
  // whole question. The dart shot alone is nine minutes, so a run with
  // no progress output is indistinguishable from a run that has died.
  const step = (what) => process.stdout.write(`\r  ${shot.name}: ${what}`.padEnd(48));
  /** How long to wait for a frame before repeating the previous one.
   *
   * THESE WERE ONCE 1.5s AND 30s AND IT RUINED A WHOLE CUT. Filming
   * moved to a 1.5x device scale factor, which took a DOM capture from
   * about 0.2s to about 1.1s, and 1.5s stopped being generous. Nearly
   * every capture tripped the timeout, every shot fell back to
   * repeating the frame before, and the result was 26 seconds of frozen
   * stills - 78 of 80 frames in the form shot, 118 of 120 in the
   * comparison. The scroll and the typing were simply not in it.
   *
   * So the fallback is a safety net and has to be priced like one: far
   * above how long a frame actually takes, not just above it. The
   * guard below is the other half - a shot that leans on the net is now
   * a failure rather than a silently frozen shot. */
  const page = await recorder.newPage({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: DSF,
    stepMs: STEP_MS,
    shootTimeoutMs: shot.webgl ? 60_000 : 15_000,
  });
  try {
    step("loading");
    await page.load(`${origin}${shot.path}`, shot.settleMs ?? 2500);
    step("loaded");

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
      step("preparing");
      const problem = await page.evaluate(shot.prepare);
      if (problem) throw new Error(`${shot.name}: ${problem}`);
    }

    if (shot.virtualClock) {
      step("pausing the clock");
      await page.pauseClock();
      // Run the page on, unfilmed, to reach the moment worth filming.
      if (shot.warmMs) {
        step(`warming ${shot.warmMs}ms`);
        await page.advance(shot.warmMs);
      }
    }

    const frames = [];
    for (let i = 0; i < shot.frames; i++) {
      if (i % 5 === 0) step(`frame ${i + 1}/${shot.frames}`);
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
        if (shot.landOn) {
          // One number, then out of the way: the index that selects the
          // country, after which Math.random is itself again so the
          // landing point inside the border is sampled normally.
          const { index, of } = shot.landOn;
          await page.evaluate(`(() => {
            const real = Math.random;
            let used = false;
            Math.random = () => {
              if (used) return real();
              used = true;
              return ${(index + 0.5)} / ${of};
            };
            return true;
          })()`);
        }
        await page.evaluate(`document.querySelector(${JSON.stringify(shot.click.selector)}).click()`);
      }

      frames.push(await page.shoot());
      // Only a page being stepped needs stepping. A shot whose motion is
      // this script's own scrolling has a running clock and a compositor
      // that keeps painting, which is the entire point.
      if (shot.virtualClock) await page.advance();
    }
    // Did it land where it was aimed? Asked after the shot, when the card
    // has mounted. A silent miss here would be a nine-minute shot of the
    // wrong country, and the whole reason the landing is fixed is that
    // the country matters to the cut.
    if (shot.landOn) {
      const landed = await page.evaluate(`document.querySelector(".spin-result-city")?.innerText.trim() ?? ""`);
      const expected = await page.evaluate(`document.querySelector(".spin-plan")?.getAttribute("href") ?? ""`);
      if (!landed) throw new Error(`${shot.name}: no country on the result card, so the throw did not finish`);
      step(`landed in ${landed}`);
      if (!expected.includes("dest=")) {
        throw new Error(`${shot.name}: the result card has no plan link (href "${expected}")`);
      }
      process.stderr.write(`\n  ${shot.name}: landed in ${landed}\n`);
    }

    if (page.reusedFrames > 0) {
      // Said out loud rather than hidden: a shot that is mostly repeats
      // is a shot of something that was not moving, and that is worth
      // knowing before it goes in the cut.
      process.stdout.write(`\r  ${shot.name}: ${page.reusedFrames}/${shot.frames} frames unchanged`.padEnd(48));
    }
    // AND REFUSED, past a point. A cut where most frames are repeats is
    // a cut of stills, and it looks entirely plausible in a progress
    // log - the frame counts and the duration all come out right. That
    // is exactly how 26 seconds of frozen screenshots got filmed and
    // encoded without one thing going wrong on the way.
    const limit = Math.ceil(shot.frames * 0.2);
    if (page.reusedFrames > limit) {
      throw new Error(
        `${shot.name}: ${page.reusedFrames} of ${shot.frames} frames were repeats of the one ` +
          `before (more than the ${limit} allowed), so this shot is mostly a still. Either the ` +
          `page really is not moving, or shootTimeoutMs is shorter than a frame now takes to capture.`
      );
    }
    return frames;
  } finally {
    await page.close();
  }
}

// ------------------------------------------------------------------- film

recorder = await openRecorder({ chrome, args: SWIFTSHADER_ARGS });

/** PROMO_ONLY=hero,form films just those shots.
 *
 * For working on one shot without sitting through the dart's nine
 * minutes of software WebGL every time. The output is a real file, just
 * not the real cut - so it prints what it left out rather than letting
 * a four-second mp4 be mistaken for the finished thing. */
const only = (process.env.PROMO_ONLY ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const shots = only.length > 0 ? SHOTS.filter((shot) => only.includes(shot.name)) : SHOTS;
if (only.length > 0) {
  const missing = only.filter((name) => !SHOTS.some((shot) => shot.name === name));
  if (missing.length > 0) fail([`No shot called ${missing.join(", ")}. They are: ${SHOTS.map((s) => s.name).join(", ")}`]);
  console.log(`PROMO_ONLY: filming ${shots.map((s) => s.name).join(", ")} - this is NOT the full cut`);
}

const startedAt = Date.now();
for (const shot of shots) {
  const at = Date.now();
  const reused = cachedFrames(shot);
  const frames = reused ?? (shot.kind === "card" ? await card(shot.path, shot.frames) : await pageShot(shot));
  if (!reused) cacheFrames(shot, frames);
  await emit(frames, shot);
  process.stdout.write("\r".padEnd(50) + "\r");
  console.log(
    `${shot.name.padEnd(7)} ${String(frames.length).padStart(3)} frames ` +
      `(${(frames.length / FPS).toFixed(1)}s) ` +
      (reused ? "from cache" : `in ${((Date.now() - at) / 1000).toFixed(0)}s`)
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
