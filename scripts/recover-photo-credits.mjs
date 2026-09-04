#!/usr/bin/env node
// Recovers the attribution for the destination photographs already sitting
// in frontend/public/destinations, and writes it to
// frontend/lib/destinationPhotoCredits.ts.
//
// WHY THIS EXISTS
//
// Those images were fetched from Wikimedia Commons by
// scripts/fetch-destination-photos.mjs and committed. The attribution
// manifest that script also writes was never committed, so the guide pages
// - which have always been wired to display artist and licence - have been
// rendering nothing. Commons licences run from public domain through CC BY
// and CC BY-SA, and the CC ones require credit.
//
// WHY IT VERIFIES INSTEAD OF JUST RE-QUERYING
//
// The obvious fix is to re-run the original lookup and keep the metadata.
// That is wrong, and quietly so. The lookup asks Wikipedia for a city
// page's LEAD IMAGE, and lead images change: an editor swaps the photo on
// the Rome article and the same query now returns a different picture by a
// different photographer under a different licence. Writing that metadata
// next to the old file on disk would produce attribution that is confident,
// specific, and false - crediting someone who did not take the photograph
// being shown, which is worse than the current state of crediting nobody.
//
// So every candidate is downloaded and compared byte for byte with the
// local file. A match is proof the metadata belongs to the image on disk.
// A mismatch is reported and NOT written, with the options spelled out.
//
// USAGE (from the repo root, on a machine with normal internet access -
// this repo's own sandbox cannot reach Wikimedia):
//
//   node scripts/recover-photo-credits.mjs
//
// Add --write-mismatched-as-unknown to also emit entries for files it
// could not confirm, crediting them as unknown with a link to the city
// article. That is a fallback for photos whose source has genuinely moved
// on, not a default, because "Unknown" is a claim too.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHOTO_DIR = path.join(REPO_ROOT, "frontend/public/destinations");
const FACTS_DIR = path.join(REPO_ROOT, "frontend/facts");
const OUT_PATH = path.join(REPO_ROOT, "frontend/lib/destinationPhotoCredits.ts");

const API = "https://en.wikipedia.org/w/api.php";
// Matches fetch-destination-photos.mjs. The width matters: Commons serves a
// specific rendering per width, and comparing against a different one would
// never match even for the right photograph.
const THUMB_WIDTH = 1600;
const USER_AGENT =
  "decide-travel-app-attribution-recovery/1.0 (restoring credit for images already in the repo)";

const writeMismatchedAsUnknown = process.argv.includes("--write-mismatched-as-unknown");

async function cityNames() {
  const files = await fs.readdir(FACTS_DIR);
  const names = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(await fs.readFile(path.join(FACTS_DIR, file), "utf-8"));
    if (data.city) names.push(data.city);
  }
  return names;
}

const slugify = (city) => city.toLowerCase().replace(/\s+/g, "_");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const stripHtml = (html) => (html ? html.replace(/<[^>]+>/g, "").trim() : "");

async function getJson(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function candidateFor(city) {
  const pageData = await getJson({ action: "query", titles: city, prop: "pageimages", piprop: "name" });
  const filename = Object.values(pageData.query?.pages ?? {})[0]?.pageimage;
  if (!filename) return null;

  const fileData = await getJson({
    action: "query",
    titles: `File:${filename}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
  });
  const info = Object.values(fileData.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info) return null;

  const meta = info.extmetadata ?? {};
  return {
    imageUrl: info.thumburl ?? info.url,
    artist: stripHtml(meta.Artist?.value) || "Unknown",
    license: stripHtml(meta.LicenseShortName?.value) || "See source",
    sourceUrl: info.descriptionurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(city)}`,
  };
}

function moduleSource(credits) {
  const entries = Object.keys(credits)
    .sort()
    .map((slug) => {
      const c = credits[slug];
      const field = (v) => JSON.stringify(v);
      return `  ${JSON.stringify(slug)}: {
    file: ${field(c.file)},
    artist: ${field(c.artist)},
    license: ${field(c.license)},
    sourceUrl: ${field(c.sourceUrl)},
  },`;
    })
    .join("\n");

  return `// Attribution for the photographs in public/destinations.
//
// GENERATED by scripts/recover-photo-credits.mjs. Do not hand-edit: every
// entry here was confirmed by downloading the candidate from Wikimedia
// Commons and comparing it byte for byte with the file on disk, so each
// credit provably belongs to the image it names.
//
// Those licences range from public domain through CC BY and CC BY-SA, and
// the CC ones require the photographer, the licence and a link back. Every
// surface that shows one of these photographs renders this credit when an
// entry exists.

export interface DestinationPhotoCredit {
  /** The file in public/destinations this credit belongs to. */
  file: string;
  artist: string;
  license: string;
  /** The Commons file page, which is where the licence text lives. */
  sourceUrl: string;
}

/** Keyed by destination slug. */
export const DESTINATION_PHOTO_CREDITS: Record<string, DestinationPhotoCredit> = {
${entries}
};
`;
}

async function main() {
  const onDisk = new Set(
    (await fs.readdir(PHOTO_DIR)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  );
  const cities = await cityNames();

  const credits = {};
  const confirmed = [];
  const mismatched = [];
  const missing = [];

  for (const city of cities) {
    const slug = slugify(city);
    const file = [...onDisk].find((f) => f.startsWith(`${slug}.`));
    if (!file) continue;

    const localPath = path.join(PHOTO_DIR, file);
    const local = await fs.readFile(localPath);

    try {
      const candidate = await candidateFor(city);
      if (!candidate) {
        missing.push({ slug, reason: "Wikipedia returned no lead image for this article" });
        continue;
      }

      const res = await fetch(candidate.imageUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`${res.status} fetching the candidate image`);
      const remote = Buffer.from(await res.arrayBuffer());

      if (sha(remote) === sha(local)) {
        credits[slug] = {
          file,
          artist: candidate.artist,
          license: candidate.license,
          sourceUrl: candidate.sourceUrl,
        };
        confirmed.push({ slug, artist: candidate.artist, license: candidate.license });
      } else {
        mismatched.push({
          slug,
          file,
          localBytes: local.length,
          remoteBytes: remote.length,
          nowShowing: candidate.sourceUrl,
        });
        if (writeMismatchedAsUnknown) {
          credits[slug] = {
            file,
            artist: "Unknown",
            license: "See source",
            sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(city)}`,
          };
        }
      }
    } catch (e) {
      missing.push({ slug, reason: e.message });
    }

    // Be polite to Wikimedia's shared infrastructure.
    await new Promise((r) => setTimeout(r, 300));
  }

  await fs.writeFile(OUT_PATH, moduleSource(credits));

  console.log(`\nConfirmed ${confirmed.length} of ${onDisk.size} photo(s) byte for byte:\n`);
  for (const c of confirmed) console.log(`  ${c.slug.padEnd(14)} ${c.license} - ${c.artist}`);

  if (mismatched.length > 0) {
    console.log(
      `\n${mismatched.length} photo(s) could NOT be confirmed. The article's lead image has changed` +
        ` since these were downloaded, so its metadata describes a different picture:\n`
    );
    for (const m of mismatched) {
      console.log(`  ${m.slug.padEnd(14)} local ${m.localBytes}B vs candidate ${m.remoteBytes}B`);
      console.log(`  ${" ".repeat(14)} article now shows: ${m.nowShowing}`);
    }
    console.log(
      `\n  Three ways out, in order of preference:\n` +
        `    1. Re-run scripts/fetch-destination-photos.mjs to replace those images with the\n` +
        `       current ones, whose attribution this script can then confirm.\n` +
        `    2. Find each file on Commons by hand and add its entry.\n` +
        `    3. Delete the unattributable images - the guides fall back to a generated banner,\n` +
        `       and the hero and trip cover simply skip that city.\n` +
        `  Re-running with --write-mismatched-as-unknown credits them as unknown instead, which\n` +
        `  does not satisfy CC BY.`
    );
  }

  if (missing.length > 0) {
    console.log(`\n${missing.length} lookup(s) failed outright:\n`);
    for (const m of missing) console.log(`  ${m.slug.padEnd(14)} ${m.reason}`);
  }

  console.log(`\nWrote ${Object.keys(credits).length} entr(y|ies) to frontend/lib/destinationPhotoCredits.ts`);
  console.log("Review the licences before committing, then run: npm run check:covers");
}

main();
