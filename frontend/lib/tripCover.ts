// Matching a trip's typed destination to one of the destination-guide
// photos already in public/destinations.
//
// Client-safe on purpose. lib/destinations.ts reads the filesystem, so it
// cannot be imported into the trip page, which is client-rendered (it polls
// /api/job). This is the small part the browser needs: which cities have a
// photo, and how to get from "rome" or "Rome, Italy" to that file.
//
// The list is checked against the real directory by
// scripts/checkCoverPhotos.mjs, so a photo added or removed without
// updating this file fails the build rather than silently showing a blank
// cover.

export const COVER_PHOTO_SLUGS = [
  "amsterdam",
  "athens",
  "bangkok",
  "barcelona",
  "berlin",
  "bruges",
  "brussels",
  "budapest",
  "copenhagen",
  "dubai",
  "florence",
  "lisbon",
  "london",
  "madrid",
  "mexico_city",
  "munich",
  "new_york",
  "paris",
  "prague",
  "rome",
  "singapore",
  "tokyo",
  "venice",
  "vienna",
] as const;

const SLUGS = new Set<string>(COVER_PHOTO_SLUGS);

/** "New York, USA" -> "new_york". Strips anything after a comma, because a
 * traveler typing a destination very often qualifies it with the country,
 * and folds accents so "Zürich" would match a "zurich" file. */
function slugify(city: string): string {
  return city
    .split(",")[0]
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The first destination on the trip that we have a photo for, or null.
 *
 * Null is a normal outcome, not a failure: the guides cover 24 cities and
 * this product plans trips anywhere. The cover falls back to a typographic
 * treatment rather than a broken image or a stock photo of somewhere else,
 * which would be worse than no photo at all - a picture of the wrong city
 * on your own itinerary reads as carelessness. */
export function coverPhotoFor(destinations: string[] | undefined): { src: string; slug: string } | null {
  for (const city of destinations ?? []) {
    const slug = slugify(city);
    if (SLUGS.has(slug)) return { src: `/destinations/${slug}.jpg`, slug };
  }
  return null;
}
