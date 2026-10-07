// Regenerates the raster app icons from public/logo-icon.svg.
//
// These exist because a PNG is required where an SVG is not accepted: the
// web manifest's install icons, iOS's apple-touch-icon, and the image a
// chat app shows when someone pastes a link. The mark itself only lives in
// one place, logo-icon.svg, which the site header renders directly.
//
// Which is exactly how they went stale. The logo's middle stroke changed
// from teal to green in "Green, and a form that reads as three questions"
// (2026-09-02); these three PNGs were last written on 2026-08-20 and
// nobody regenerated them. For five weeks the site showed a green mark and
// every share preview, home-screen icon and installed app icon showed a
// teal one. Reported from a Messenger thread, which is the only place the
// difference is visible side by side.
//
// So the conversion is a script rather than a memory. Run it whenever
// logo-icon.svg changes:
//
//   node scripts/makeAppIcons.mjs
//
// CHROMIUM_PATH overrides the browser. No playwright dependency, unlike
// makeLaunchScreens.mjs - the CLI's own --screenshot is enough for a
// static image and needs nothing installed.

import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BROWSER =
  process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** The icons' own background.
 *
 * The mark is drawn on parchment rather than transparency because a
 * maskable icon is composited onto a background the launcher chooses, and
 * a transparent one lands on whatever that happens to be. Taken from the
 * icons being replaced (sampled: #f7f1e2) so this is a redraw of the same
 * design, not a redesign of it. */
const BACKGROUND = "#f7f1e2";

/** How much of the canvas the mark fills.
 *
 * Measured off the icons being replaced rather than chosen: the mark's
 * bounding box was 66px wide in a 192px canvas, and the SVG's own content
 * is 67.5 of its 100 viewBox units, which puts the artboard at 97.8px -
 * 51% of the canvas. Rendering the SVG at full size would have produced a
 * correctly coloured icon that no longer matched the one people have on
 * their home screens. */
const MARK_SCALE = 0.51;

/** Chromium will not lay a page out narrower than this, whatever
 * --window-size says, so a 192px window renders a distorted viewport: the
 * mark came out 98px wide and 60 tall with its bottom cut off, which is
 * how the second attempt produced icons with no dot. Everything is
 * therefore laid out at a multiple of the target above this floor and
 * scaled back down by the device pixel ratio, which costs nothing and
 * antialiases better than rendering small ever would. */
const MIN_LAYOUT_PX = 540;

/** The whole-number factor that lifts a target above that floor. Whole on
 * purpose: 540/3 is exactly 180, where a fractional ratio would leave
 * Chromium rounding the output and quietly handing back a 181px icon. */
function layoutFactor(size) {
  return Math.max(1, Math.ceil(MIN_LAYOUT_PX / size));
}

const TARGETS = [
  { file: join(ROOT, "public", "icon-192.png"), size: 192 },
  { file: join(ROOT, "public", "app-icon-512.png"), size: 512 },
  { file: join(ROOT, "app", "apple-icon.png"), size: 180 },
];

/** Centred by absolute positioning, NOT by flex.
 *
 * A flex item carrying an explicit height still got squashed here: the
 * mark rendered 98px wide and about 60 tall, so the bottom of the SVG -
 * the coral dot, the whole point of the mark - was cut off the icon
 * entirely. The first run produced three icons with the right colour and
 * no dot. Absolute positioning has no such negotiation: the box is the
 * size it is told to be.
 *
 * position:relative on the body is what makes that work at these sizes.
 * Without it the absolute box resolves against the INITIAL CONTAINING
 * BLOCK - the viewport - and headless Chromium refuses to lay out a
 * viewport narrower than about 500px however small the window is asked to
 * be. So left/top of 50% put the mark at 250,250 while the screenshot
 * cropped 192x192, and the 192 and 180 icons came out completely empty
 * while the 512 one, whose crop was large enough to contain that point,
 * looked perfect. The same minimum viewport the touch-target guard works
 * around with an iframe, and the reason every icon is laid out at a size
 * above it (see MIN_LAYOUT_PX). */
function page(svg, size) {
  const mark = Math.round(size * MARK_SCALE);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:${BACKGROUND}}
body{position:relative}
svg{position:absolute;left:50%;top:50%;width:${mark}px;height:${mark}px;transform:translate(-50%,-50%);display:block}
</style></head><body>${svg}</body></html>`;
}

/** The minimum PNG reading and writing this script needs.
 *
 * Chromium cannot be asked for a scale under 0.5 and will not lay out a
 * page under MIN_LAYOUT_PX, which between them make a 192px icon
 * impossible to render directly. So it renders at a whole multiple and
 * this averages the result down. No image library: these are two dozen
 * lines against a format this script both wrote and reads, and adding a
 * dependency to a one-off asset generator costs more than it saves.
 *
 * Only 8-bit RGB and RGBA, non-interlaced, which is what Chromium writes.
 * Anything else throws rather than guessing. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colorType = body[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG: depth ${depth}, color type ${colorType}`);
      }
      channels = colorType === 2 ? 3 : 4;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body));
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++];
    const row = raw.subarray(read, read + stride);
    read += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** Every row written with filter 0. These are tiny images and the saving
 * from a cleverer filter is not worth the code that chooses it. */
function encodePng({ width, height, channels, pixels }) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Box average, which is the right filter for an exact whole-number
 * reduction: every output pixel is the mean of the factor*factor block it
 * came from, so nothing is dropped and nothing is weighted twice. */
function downsample(image, factor) {
  if (factor === 1) return image;
  const { channels } = image;
  const width = image.width / factor;
  const height = image.height / factor;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`${image.width}x${image.height} does not divide by ${factor}`);
  }
  const pixels = Buffer.alloc(width * height * channels);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          const row = (y * factor + dy) * image.width * channels;
          for (let dx = 0; dx < factor; dx++) {
            sum += image.pixels[row + (x * factor + dx) * channels + c];
          }
        }
        pixels[(y * width + x) * channels + c] = Math.round(sum / area);
      }
    }
  }
  return { width, height, channels, pixels };
}

const svg = await readFile(join(ROOT, "public", "logo-icon.svg"), "utf8");
const work = await mkdtemp(join(tmpdir(), "decide-icons-"));

try {
  for (const { file, size } of TARGETS) {
    const factor = layoutFactor(size);
    const html = join(work, `icon-${size}.html`);
    await writeFile(html, page(svg, size * factor), "utf8");
    execFileSync(
      BROWSER,
      [
        "--headless=new",
        "--no-sandbox",
        "--no-zygote",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        // Rendered at full scale and resampled below, rather than asking
        // Chromium to scale down: --force-device-scale-factor refuses to
        // go under 0.5, so a factor of 1/3 silently became 1/2 and the
        // 192px icon was written 288px square.
        "--force-device-scale-factor=1",
        `--window-size=${size * factor},${size * factor}`,
        `--screenshot=${file}`,
        `file://${html}`,
      ],
      { stdio: "ignore" }
    );
    if (factor > 1) {
      const small = downsample(decodePng(await readFile(file)), factor);
      if (small.width !== size || small.height !== size) {
        throw new Error(`resampled to ${small.width}x${small.height}, wanted ${size}`);
      }
      await writeFile(file, encodePng(small));
    }
    console.log(`wrote ${file.replace(`${ROOT}/`, "")} (${size}x${size}, rendered at ${size * factor})`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
