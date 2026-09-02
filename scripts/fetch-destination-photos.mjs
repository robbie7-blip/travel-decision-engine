#!/usr/bin/env node
// Pulls one representative lead photo per /destinations city from
// Wikipedia/Wikimedia Commons, plus its license/attribution metadata.
//
// Why this is a separate script instead of something the app just does at
// build time: this repo's own dev/build sandbox has no outbound network
// access to Wikipedia (or any image host), so nothing here can fetch these
// itself. Run this once on a machine or CI job that DOES have normal
// internet access - your laptop, a GitHub Action, Vercel's build step -
// then commit the results. The destination pages already know to prefer a
// real photo over the generated banner the moment one exists on disk (see
// lib/destinations.ts's getDestinationPhoto), so no other code changes are
// needed after running this.
//
// Usage (from the repo root):
//   node scripts/fetch-destination-photos.mjs
//
// Requires Node 18+ (uses the global fetch API). Writes:
//   frontend/public/destinations/<slug>.<ext>       - the photo itself
//   frontend/lib/destinationPhotoCredits.json        - attribution manifest
//
// Wikipedia/Commons images carry a range of licenses (public domain,
// CC-BY, CC-BY-SA, ...) - review frontend/lib/destinationPhotoCredits.json
// after running this and make sure the attribution shown on each guide
// page (already wired up in app/destinations/[slug]/page.tsx) satisfies
// whatever license each photo actually turned out to carry.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(REPO_ROOT, "frontend/public/destinations");
const CREDITS_PATH = path.join(REPO_ROOT, "frontend/lib/destinationPhotoCredits.json");
const FACTS_DIR = path.join(REPO_ROOT, "frontend/facts");

const API = "https://en.wikipedia.org/w/api.php";
const THUMB_WIDTH = 1600;
const USER_AGENT = "decide-travel-app-destination-photos/1.0 (single run, non-commercial hobby project)";

async function cityNames() {
  const files = await fs.readdir(FACTS_DIR);
  const names = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(await fs.readFile(path.join(FACTS_DIR, file), "utf-8"));
    if (data.city) names.push(data.city);
  }
  return names;
}

function slugify(city) {
  return city.toLowerCase().replace(/\s+/g, "_");
}

async function getJson(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function stripHtml(html) {
  return html ? html.replace(/<[^>]+>/g, "").trim() : "";
}

async function fetchCityPhoto(city) {
  // Step 1: find the page's lead image filename.
  const pageData = await getJson({ action: "query", titles: city, prop: "pageimages", piprop: "name" });
  const pages = Object.values(pageData.query?.pages ?? {});
  const filename = pages[0]?.pageimage;
  if (!filename) return null;

  // Step 2: pull that file's full metadata - license, artist, direct URL -
  // from its File: page, which pageimages alone doesn't include.
  const fileData = await getJson({
    action: "query",
    titles: `File:${filename}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
  });
  const filePages = Object.values(fileData.query?.pages ?? {});
  const info = filePages[0]?.imageinfo?.[0];
  if (!info) return null;

  const meta = info.extmetadata ?? {};
  return {
    imageUrl: info.thumburl ?? info.url,
    credit: {
      artist: stripHtml(meta.Artist?.value) || "Unknown",
      license: stripHtml(meta.LicenseShortName?.value) || "See source",
      sourceUrl: info.descriptionurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(city)}`,
    },
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const cities = await cityNames();
  const credits = {};
  let ok = 0;
  let failed = 0;

  for (const city of cities) {
    const slug = slugify(city);
    try {
      const result = await fetchCityPhoto(city);
      if (!result) {
        console.warn(`[skip] no lead image found for ${city}`);
        failed++;
        continue;
      }
      const imgRes = await fetch(result.imageUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!imgRes.ok) throw new Error(`${imgRes.status} fetching image`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ext = path.extname(new URL(result.imageUrl).pathname) || ".jpg";
      const outPath = path.join(OUT_DIR, `${slug}${ext}`);
      await fs.writeFile(outPath, buf);
      credits[slug] = { file: `${slug}${ext}`, ...result.credit };
      console.log(`[ok] ${city} -> public/destinations/${slug}${ext} (${result.credit.license}, ${result.credit.artist})`);
      ok++;
    } catch (e) {
      console.error(`[error] ${city}:`, e.message);
      failed++;
    }
    // Be polite to Wikimedia's shared infrastructure - no need to hammer it.
    await new Promise((r) => setTimeout(r, 300));
  }

  await fs.writeFile(CREDITS_PATH, JSON.stringify(credits, null, 2));
  console.log(`\n${ok} photo(s) fetched, ${failed} skipped/failed.`);
  console.log(`Credits written to frontend/lib/destinationPhotoCredits.json - review licenses before committing.`);
}

main();
