// Keeps lib/tripCover.ts's slug list in step with public/destinations.
//
// That list exists because the trip page is client-rendered and cannot read
// the filesystem, so it carries a hand-written copy of which cities have a
// photo. A hand-written copy of a directory listing drifts: add a photo and
// no trip ever shows it, remove one and the cover renders a broken image.
// Neither failure is visible in a build log, and both are invisible until
// somebody generates a trip to that exact city.
//
// Same principle as checkContrast.mjs and checkDashes.mjs: zero
// dependencies, runs in milliseconds, fails the build rather than waiting
// to be noticed.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const onDisk = new Set(
  readdirSync(join(ROOT, "public", "destinations"))
    .filter((name) => PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .map((name) => name.slice(0, name.lastIndexOf(".")))
);

const source = readFileSync(join(ROOT, "lib", "tripCover.ts"), "utf8");
const block = source.slice(source.indexOf("COVER_PHOTO_SLUGS"), source.indexOf("] as const"));
const declared = new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));

const missing = [...onDisk].filter((slug) => !declared.has(slug)).sort();
const extra = [...declared].filter((slug) => !onDisk.has(slug)).sort();

if (missing.length > 0 || extra.length > 0) {
  console.error("lib/tripCover.ts's COVER_PHOTO_SLUGS does not match public/destinations.\n");
  if (missing.length > 0) {
    console.error(`  Photos on disk but not listed (no trip will ever use them): ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    console.error(`  Listed but no photo on disk (the cover would 404): ${extra.join(", ")}`);
  }
  process.exit(1);
}

// The cover builds its src as `${slug}.jpg`, so a photo saved in another
// format would be listed, pass the check above, and still 404.
const notJpg = [...onDisk].filter((slug) => !readdirSync(join(ROOT, "public", "destinations")).includes(`${slug}.jpg`));
if (notJpg.length > 0) {
  console.error(`Cover photos must be .jpg (coverPhotoFor builds the path): ${notJpg.sort().join(", ")}`);
  process.exit(1);
}

console.log(`All ${onDisk.size} destination photos are listed and reachable.`);
