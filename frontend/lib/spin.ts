// The pool for "Spin the wheel".
//
// Only cities this product actually knows: the 24 that have a curated
// facts file, a guide page and a real photograph. A wheel that could land
// on any of 195 countries would be a better toy and a worse feature -
// every result here opens onto something real, and the spin is a way into
// the product rather than a novelty next to it.
//
// Keyed by the same slug as public/destinations and facts/, so a result
// carries straight through to /destinations/<slug> and to the trip form's
// ?dest= prefill.

import { COVER_PHOTO_SLUGS } from "./tripCover";
import { DESTINATION_CITY_NAMES_BG } from "./destinationCityNamesBg";
import type { Language } from "./types";

/** How many slices are on the wheel at once. Twelve is the most that stays
 * legible: at 24 each slice is 15 degrees and the labels collapse into
 * unreadable slivers. The rest of the pool arrives by reshuffling. */
export const WHEEL_SLICES = 12;

export type SpinSlug = (typeof COVER_PHOTO_SLUGS)[number];

/** Every city that can come up. */
export const SPIN_POOL: readonly SpinSlug[] = COVER_PHOTO_SLUGS;

/** Display name for a slug. The English names are just the slug
 * title-cased, which is exactly right for all 24 ("new_york" is the only
 * one with a separator), and Bulgarian comes from the guides' own map so
 * the wheel and the page it links to agree. */
export function spinCityName(slug: string, language: Language): string {
  if (language === "bg" && DESTINATION_CITY_NAMES_BG[slug]) return DESTINATION_CITY_NAMES_BG[slug];
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** A shuffled selection of WHEEL_SLICES cities.
 *
 * Fisher-Yates on a copy: a naive `sort(() => Math.random() - 0.5)` is not
 * a uniform shuffle, which for a wheel means some cities quietly come up
 * more often than others. This is the one place in the product where
 * "random" is the actual promise being made to the traveler. */
export function drawWheel(random: () => number = Math.random): SpinSlug[] {
  const pool = [...SPIN_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, WHEEL_SLICES);
}

/** The first wheel, before any client-side shuffle.
 *
 * Deliberately deterministic: this renders on the server too, and a
 * randomised first render would produce a hydration mismatch and a visible
 * flicker as React replaced the whole wheel. The client reshuffles after
 * mount, so a visitor still gets a different wheel each time. */
export const INITIAL_WHEEL: SpinSlug[] = SPIN_POOL.slice(0, WHEEL_SLICES) as SpinSlug[];
