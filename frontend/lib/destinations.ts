// Read-only accessor for the curated facts/*.json files, used by the public
// /destinations guide pages. Deliberately separate from
// lib/engine/prompt.ts's loadFacts (which only needs category+text for the
// model prompt) since these pages also need the display name and the full
// list of available slugs, and this file must NOT be mirrored to the
// worker - it's Next.js/fs-at-build-time only.

import fs from "node:fs";
import path from "node:path";
import { DESTINATION_FACTS_BG } from "./destinationFactsBg";
import { DESTINATION_CITY_NAMES_BG } from "./destinationCityNamesBg";
import type { Language } from "./types";

const FACTS_DIR = path.join(process.cwd(), "facts");

// Real photos are opt-in: this repo's own build environment has no network
// access to fetch any (see scripts/fetch-destination-photos.mjs, meant to
// be run somewhere that does), so pages fall back to a generated banner
// (components/DestinationBanner) until a photo actually exists on disk.
const PHOTO_DIR = path.join(process.cwd(), "public/destinations");
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const PHOTO_CREDITS_PATH = path.join(process.cwd(), "lib/destinationPhotoCredits.json");

export interface DestinationFact {
  category: string;
  text: string;
}

export interface DestinationPhotoCredit {
  file: string;
  artist: string;
  license: string;
  sourceUrl: string;
}

export interface DestinationPhoto {
  src: string;
  credit: DestinationPhotoCredit | null;
}

export interface Destination {
  slug: string;
  city: string;
  facts: DestinationFact[];
}

export function listDestinationSlugs(): string[] {
  if (!fs.existsSync(FACTS_DIR)) return [];
  return fs
    .readdirSync(FACTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadDestination(slug: string): Destination | null {
  const filePath = path.join(FACTS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { slug, city: data.city ?? slug, facts: data.facts ?? [] };
  } catch {
    return null;
  }
}

export function listDestinations(): Destination[] {
  return listDestinationSlugs()
    .map(loadDestination)
    .filter((d): d is Destination => d !== null);
}

/** Facts for a destination in the requested language - falls back to the
 * English facts (from facts/*.json) if no Bulgarian translation exists yet
 * for this slug in destinationFactsBg.ts, rather than showing nothing. */
export function getLocalizedFacts(slug: string, language: Language, fallback: DestinationFact[]): DestinationFact[] {
  if (language === "bg" && DESTINATION_FACTS_BG[slug]) return DESTINATION_FACTS_BG[slug];
  return fallback;
}

/** Display name only - never used for ?dest= or anything the engine
 * matches destinations against, which always stays the canonical English
 * name from facts/*.json. */
export function getLocalizedCityName(slug: string, language: Language, fallback: string): string {
  if (language === "bg" && DESTINATION_CITY_NAMES_BG[slug]) return DESTINATION_CITY_NAMES_BG[slug];
  return fallback;
}

let creditsCache: Record<string, DestinationPhotoCredit> | null = null;
function loadPhotoCredits(): Record<string, DestinationPhotoCredit> {
  if (creditsCache) return creditsCache;
  if (!fs.existsSync(PHOTO_CREDITS_PATH)) {
    creditsCache = {};
    return creditsCache;
  }
  try {
    creditsCache = JSON.parse(fs.readFileSync(PHOTO_CREDITS_PATH, "utf-8"));
  } catch {
    creditsCache = {};
  }
  return creditsCache!;
}

/** Returns a real photo for this destination if one has been fetched onto
 * disk (see scripts/fetch-destination-photos.mjs), otherwise null - callers
 * should fall back to <DestinationBanner> when this returns null. */
export function getDestinationPhoto(slug: string): DestinationPhoto | null {
  for (const ext of PHOTO_EXTENSIONS) {
    if (fs.existsSync(path.join(PHOTO_DIR, `${slug}${ext}`))) {
      return { src: `/destinations/${slug}${ext}`, credit: loadPhotoCredits()[slug] ?? null };
    }
  }
  return null;
}
