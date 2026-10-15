#!/usr/bin/env node
// Finds freely licensed replacement photos for the destination covers on
// Wikimedia Commons, with their attribution, for a person to choose from.
//
// WHY. Most of the photos in frontend/public/destinations were uploaded
// with no record of where they came from, and all eighteen of them are 612
// pixels wide - the size stock libraries serve as a preview. A photo with
// no provable licence cannot stay on a public site.
//
// HOW IT CHOOSES. For each city it searches Commons' "Quality images" (a
// community-reviewed set) for a landmark scene, keeps only landscape JPEGs
// at least 2000px wide under a licence that allows reuse with credit (CC0,
// public domain, CC BY, CC BY-SA), and saves the top three at 1600px wide
// with their author, licence and source page. Nothing is published: the
// candidates land in photo-candidates/ for a person to look at, and
// scripts/promote-photo-candidates.mjs moves the chosen ones into place.
//
// Needs network access to Wikimedia, which the dev sandbox does not have:
// run by .github/workflows/photo-candidates.yml.
//
// Usage: node scripts/fetch-commons-candidates.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "photo-candidates");
const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "decide-travel-cover-photos/1.0 (https://yourdecide.com; licensed photo selection)";
const PER_CITY = 3;

// What each city's cover should show: the thing a traveller recognises.
const CITIES = {
  amsterdam: ["Amsterdam canal houses", "Amsterdam canal"],
  athens: ["Acropolis of Athens", "Athens Parthenon"],
  barcelona: ["Sagrada Familia", "Barcelona skyline"],
  berlin: ["Brandenburg Gate", "Berlin Cathedral Spree"],
  bruges: ["Bruges canal", "Bruges Rozenhoedkaai"],
  brussels: ["Grand Place Brussels", "Brussels Town Hall"],
  budapest: ["Hungarian Parliament Building Danube", "Budapest Chain Bridge"],
  copenhagen: ["Nyhavn", "Copenhagen harbour"],
  florence: ["Florence Cathedral", "Florence Ponte Vecchio"],
  lisbon: ["Lisbon Alfama", "Lisbon tram"],
  london: ["Tower Bridge London", "Palace of Westminster"],
  madrid: ["Madrid Gran Via", "Royal Palace of Madrid"],
  munich: ["Munich Marienplatz", "Munich Frauenkirche"],
  paris: ["Eiffel Tower Paris", "Paris Seine"],
  prague: ["Charles Bridge Prague", "Prague Old Town Square"],
  rome: ["Colosseum Rome", "Rome Trevi Fountain"],
  venice: ["Grand Canal Venice", "Venice Rialto Bridge"],
  vienna: ["Schönbrunn Palace", "Vienna Hofburg"],
};

const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const ALLOWED_LICENCE = /^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?( [a-z]+)?)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { json = true } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 429 || res.status >= 500) {
      // Commons asks clients to back off; doing so is what makes a run of
      // twenty cities finish rather than fail halfway.
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return json ? res.json() : Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`gave up after retries: ${url}`);
}

function plain(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function search(query, qualityOnly) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap${qualityOnly ? " incategory:Quality_images" : ""}`,
    gsrlimit: "30",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1600",
  });
  const data = await get(`${API}?${params}`);
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info || info.mime !== "image/jpeg") continue;
    if (info.width < 2000 || info.width / info.height < 1.3 || info.width / info.height > 1.9) continue;
    const meta = info.extmetadata ?? {};
    const licence = plain(meta.LicenseShortName?.value);
    if (!ALLOWED_LICENCE.test(licence)) continue;
    const artist = plain(meta.Artist?.value) || "Unknown";
    out.push({
      title: page.title,
      thumb: info.thumburl,
      sourceUrl: info.descriptionurl,
      artist: artist.slice(0, 120),
      license: licence,
      licenseUrl: plain(meta.LicenseUrl?.value) || null,
      width: info.width,
      height: info.height,
    });
  }
  return out;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const manifest = [];
  for (const [slug, queries] of Object.entries(CITIES)) {
    if (ONLY.length && !ONLY.includes(slug)) continue;
    const found = [];
    // Quality images first; plain search only when a city has too few.
    for (const qualityOnly of [true, false]) {
      for (const q of queries) {
        if (found.length >= PER_CITY) break;
        for (const c of await search(q, qualityOnly)) {
          if (found.length >= PER_CITY) break;
          if (!found.some((f) => f.title === c.title)) found.push({ ...c, qualityImage: qualityOnly });
        }
        await sleep(1500);
      }
    }
    for (let i = 0; i < found.length; i++) {
      const c = found[i];
      const raw = path.join(OUT, `${slug}-${i + 1}.raw.jpg`);
      const file = path.join(OUT, `${slug}-${i + 1}.jpg`);
      await fs.writeFile(raw, await get(c.thumb, { json: false }));
      // 1600 wide, re-encoded the way the existing covers are, metadata
      // stripped (the credit lives in the manifest, not the EXIF).
      execFileSync("convert", [raw, "-resize", "1600x>", "-strip", "-interlace", "Plane", "-quality", "74", file]);
      await fs.rm(raw);
      manifest.push({ slug, choice: i + 1, file: path.basename(file), ...c });
      await sleep(1000);
    }
    console.log(`${slug}: ${found.length} candidate(s)`);
  }
  await fs.writeFile(path.join(OUT, "candidates.json"), JSON.stringify(manifest, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
