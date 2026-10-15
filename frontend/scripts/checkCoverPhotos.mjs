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

import { readdirSync, readFileSync, statSync } from "node:fs";
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

// Attribution. Every photo must be accounted for: credited (most Commons
// licences require the photographer, the licence and a link back), or
// listed under the licence that asks for no credit. This used to only
// warn, while the old photos had no known source; since they were
// replaced it fails, so a new photo cannot arrive without its licence.
const creditsSource = readFileSync(join(ROOT, "lib", "destinationPhotoCredits.ts"), "utf8");
// Both the credited photos and the ones whose licence asks for none
// (CREDIT_NOT_REQUIRED) count as accounted for.
const creditedBlock = creditsSource.slice(creditsSource.indexOf("DESTINATION_PHOTO_CREDITS"));
const credited = new Set([...creditedBlock.matchAll(/^\s{2}"([a-z0-9_]+)":/gm)].map((m) => m[1]));
const uncredited = [...onDisk].filter((slug) => !credited.has(slug)).sort();

// ---------------------------------------------------------------------------
// And that every one of them is served THROUGH next/image.
//
// WHY. These are big photographs - measured at 42kB to 549kB, six of them
// 1200-1600px wide - and they render into boxes measured at 326px on a
// phone. Served as a raw <img src="/destinations/tokyo.jpg">, the homepage
// transferred 942kB, 391kB of it that one file. Through next/image the
// same frame is a 71kB WebP at the width the device asked for, and the
// page is 608kB.
//
// The fix is one word per call site, which is exactly why it needs a
// guard: the next person to add a photo somewhere will reach for <img>,
// it will look identical on their laptop, and nothing else in this repo
// would notice. A `new Image()` preloader counts too - HeroGallery had one
// that fetched the raw file, so for a while the page would have downloaded
// the original AND the optimised copy.

const SOURCE_DIRS = ["app", "components"];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(rel);
  }
  return out;
}

const rawUses = [];

/** Whether this file is one that renders a destination PHOTOGRAPH.
 *
 * Matched on the machinery rather than on the path, and that correction is
 * the point: the first version of this looked for a literal
 * "/destinations/....jpg" and therefore missed components/TripCover.tsx,
 * which renders `photo.src` out of coverPhotoFor() - the full-bleed hero
 * on the trip page, and the single biggest file on it. A guard that misses
 * the biggest case is worse than none, because it reports the rule as
 * held. */
function rendersCoverPhoto(text) {
  return /coverPhotoFor|DESTINATION_PHOTO_CREDITS|\/destinations\//.test(text);
}

/** An <img> that is an icon, not a photograph.
 *
 * SVG logos and the PWA icons are raw <img> on purpose - next/image does
 * not resize vector art, and these files are one to four kB. Narrow by
 * design: only a src that is a LITERAL path to one of those is exempt, so
 * a photograph behind a variable can never qualify. */
function isIconTag(tag) {
  return (
    /src="[^"]*\.svg"/.test(tag) ||
    /src="\/icon-[^"]*\.png"/.test(tag) ||
    // A data URI is already inline - there is nothing to optimise and
    // nothing to download.
    /src=\{?["{]?[A-Z_]*DATA_URI/.test(tag) ||
    /src="data:/.test(tag)
  );
}

/** Comments blanked out, offsets preserved.
 *
 * Needed because this check kept flagging ITSELF: the comment above
 * HeroGallery's <Image> says "next/image, not <img>" and explains the
 * `new Image()` preloader it replaced, and a plain text search read both
 * as breaches. A guard that fires on the note explaining it is a guard
 * nobody will keep.
 *
 * Offsets are preserved rather than the comments removed, so the line
 * numbers reported still point at the real line. The `://` exclusion
 * keeps a URL inside a string from being mistaken for the start of a
 * comment. */
function withoutComments(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out
    .split("\n")
    .map((line) => {
      const at = line.search(/(^|[^:])\/\//);
      if (at === -1) return line;
      const cut = line.indexOf("//", at);
      return line.slice(0, cut) + " ".repeat(line.length - cut);
    })
    .join("\n");
  return out;
}

/** Routes that render an image with Satori (next/og), where <img> is the
 * only element available - next/image does not exist in that renderer. */
function isOgImageRoute(file) {
  return /opengraph-image|twitter-image|\/icon\.tsx$|apple-icon/.test(file);
}

for (const file of SOURCE_DIRS.flatMap((d) => sourceFiles(d))) {
  const raw = readFileSync(join(ROOT, file), "utf8");
  if (isOgImageRoute(file)) continue;
  const text = withoutComments(raw);
  if (!rendersCoverPhoto(text)) continue;

  for (const m of text.matchAll(/<img\b/g)) {
    // The tag, from "<img" to its close - enough to see the src.
    const tag = text.slice(m.index, text.indexOf(">", m.index) + 1);
    if (isIconTag(tag)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    rawUses.push(`${file}:${line}  ${tag.replace(/\s+/g, " ").slice(0, 70)}`);
  }

  for (const m of text.matchAll(/new Image\(/g)) {
    const line = text.slice(0, m.index).split("\n").length;
    rawUses.push(`${file}:${line}  new Image() preloader - fetches the raw file`);
  }
}

if (rawUses.length > 0) {
  console.error(
    "\nA destination photograph is being served without next/image.\n\n" +
      rawUses.map((u) => `  ${u}`).join("\n") +
      "\n\nUse <Image fill sizes={...}> instead. These files are up to 549kB and\n" +
      "render into boxes a few hundred pixels wide; a raw <img> ships the whole\n" +
      "original to a phone. components/HeroGallery.tsx has the pattern and the\n" +
      "measurements behind it.\n\n" +
      "`sizes` is not optional - without it next/image assumes 100vw and serves\n" +
      "a far bigger file than the box needs.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A ceiling on the originals.
//
// Generous on purpose: next/image means the source size is no longer what
// a visitor downloads, so this is not about page weight any more. It is
// about what gets committed, deployed and handed to the optimiser - and
// about noticing when somebody drops a 12MB camera original in here.
const MAX_SOURCE_KB = 700;
const tooBig = readdirSync(join(ROOT, "public", "destinations"))
  .filter((name) => PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext)))
  .map((name) => ({ name, kb: Math.round(statSync(join(ROOT, "public", "destinations", name)).size / 1024) }))
  .filter((f) => f.kb > MAX_SOURCE_KB);

if (tooBig.length > 0) {
  console.error(
    `\nA destination photograph is over ${MAX_SOURCE_KB}kB.\n\n` +
      tooBig.map((f) => `  ${f.kb}kB  ${f.name}`).join("\n") +
      "\n\nResize it before committing. next/image serves a right-sized WebP to\n" +
      "visitors either way, so this is about the repo and the deploy, not the\n" +
      "page - but a multi-megabyte original is still something to know about.\n"
  );
  process.exit(1);
}

console.log(`All ${onDisk.size} destination photos are listed and reachable.`);

if (uncredited.length > 0) {
  console.error(
    `\n${uncredited.length} of ${onDisk.size} photo(s) have no licence on record: ${uncredited.join(", ")}\n` +
      `  Add each to DESTINATION_PHOTO_CREDITS (photographer, licence, source page) or, if its\n` +
      `  licence asks for no credit, to CREDIT_NOT_REQUIRED - in lib/destinationPhotoCredits.ts.`
  );
  process.exit(1);
} else {
  console.log(`All ${onDisk.size} are attributed.`);
}
