// The cities this product has a guide for, and how to name one.
//
// Called spin.ts because it was written for "Spin the wheel", and the
// wheel is gone: the dart superseded it everywhere - it reaches 168
// countries where the wheel reached 24 cities - and keeping a second way
// to ask the same question only meant two features to maintain and a
// choice nobody needed to make. What is left here is the part that was
// never about the wheel.
//
// The file keeps its name on purpose. SPIN_POOL and spinCityName are
// referenced from lib/dartGlobe.ts and components/GlobeDart.tsx, the page
// is still /decide-for-me, and renaming a module to erase a feature's
// history costs a diff across several files and buys nothing. The
// drawWheel/INITIAL_WHEEL/WHEEL_SLICES machinery went with the wheel: it
// had no callers left but its own test, which is the definition of dead
// code and exactly the kind that reads as load-bearing a year later.
//
// Only cities this product actually knows: the 24 with a curated facts
// file, a guide page and a real photograph. The original argument for that
// still holds and is now lib/dartGlobe.ts's to make - a result that opens
// onto something real beats a result that is merely a place name - the
// difference being that the dart does not need a guide to make a country
// plannable, so a guide is a bonus on a result rather than a condition of
// being one.
//
// Keyed by the same slug as public/destinations and facts/, so a result
// carries straight through to /destinations/<slug> and to the trip form's
// ?dest= prefill.

import { COVER_PHOTO_SLUGS } from "./tripCover";
import { DESTINATION_CITY_NAMES_BG } from "./destinationCityNamesBg";
import type { Language } from "./types";

export type SpinSlug = (typeof COVER_PHOTO_SLUGS)[number];

/** Every city with a guide. */
export const SPIN_POOL: readonly SpinSlug[] = COVER_PHOTO_SLUGS;

/** Display name for a slug. The English names are just the slug
 * title-cased, which is exactly right for all 24 ("new_york" is the only
 * one with a separator), and Bulgarian comes from the guides' own map so a
 * result and the page it links to agree. */
export function spinCityName(slug: string, language: Language): string {
  if (language === "bg" && DESTINATION_CITY_NAMES_BG[slug]) return DESTINATION_CITY_NAMES_BG[slug];
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
