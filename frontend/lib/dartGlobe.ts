// Throw a dart at the globe: which country it hits, and where on it.
//
// WHY COUNTRIES AND NOT THE 24 GUIDES. The wheel could only land on a city
// with a curated facts file, and lib/spin.ts argues for that: "a wheel that
// could land on any of 195 countries would be a better toy and a worse
// feature". That reasoning turns out to be narrower than it sounds. The trip
// form takes free text - `?dest=Tbilisi` plans a trip to Tbilisi today - so
// the guide was never what made a result plannable. Exactly two things on the
// result card depend on one: the photograph and the "read the guide" link,
// and DestinationBanner already exists as the documented fallback for a
// missing photo. So the whole world costs one hidden button.
//
// WHY NOT A TRULY RANDOM POINT ON THE SPHERE. Because 71% of the Earth is
// ocean and most of the rest is nobody's holiday. "You are going to 74.2N,
// 98.3E" is a coordinate, not a destination, and a dart that lands in the
// Pacific four throws out of five is a broken toy. So the dart picks a
// COUNTRY and then lands on a real point inside that country's own borders -
// which keeps the one property the wheel was built around: it sticks where
// it says it sticks.
//
// WHERE THE GEOMETRY COMES FROM. lib/worldGeo.ts, the same topology the
// visited map and globe already draw, already proven correct against a live
// map. No new dataset, no hand-built crosswalk - that file's header explains
// at length why a second world dataset is an accuracy risk, and this feature
// is not a good enough reason to take it.
//
// WHAT THE DART CANNOT HIT, stated because it is a real limit and not a
// rounding error: 29 of the 197 tracked countries have no polygon in that
// topology - the microstates and small island nations, Singapore among them
// (see DART_UNREACHABLE below). Giving them coordinates would mean typing 29
// latitudes and longitudes by hand, and a wrong one puts the dart in the sea
// beside the country it names. That is the same trade worldGeo.ts already
// refused, so it is refused here too.
//
// Run: npm run test:dart-globe

import { WORLD_COUNTRY_FEATURES, type CountryFeature } from "./worldGeo";
import { COUNTRIES, getCountry } from "./countries";
import { SPIN_POOL, type SpinSlug } from "./spin";

export interface DartHit {
  /** ISO 3166-1 alpha-2 of the country the dart stuck in. */
  code: string;
  lat: number;
  lng: number;
}

/** Polygons the topology draws that lib/countries.ts deliberately does not
 * track, because "have you been there" is asked about countries.
 *
 * Declared rather than discovered, and every one checked against the raw
 * data rather than assumed - CYP and SOM in particular are NOT mis-keyed
 * Cyprus and Somalia, which both have correct alpha-2 entries of their own.
 * They are Northern Cyprus and Somaliland, drawn separately. Reading the
 * codes and inferring a key mismatch is a mistake worth leaving a marker
 * for: "correcting" CYP to CY would give Cyprus two polygons, make clicking
 * Northern Cyprus mark Cyprus visited, and have the two fight over the
 * colour - breaking working code to fix a bug that was not there. */
export const NON_COUNTRY_POLYGONS: Readonly<Record<string, string>> = {
  CYP: "Northern Cyprus",
  SOM: "Somaliland",
  EH: "Western Sahara",
  FK: "Falkland Islands",
  GL: "Greenland",
  NC: "New Caledonia",
  PR: "Puerto Rico",
};

/** Every tracked country that has geometry to land in, with it. */
export const DART_TARGETS: readonly { code: string; feature: CountryFeature }[] =
  WORLD_COUNTRY_FEATURES.flatMap((feature) => {
    const code = feature.properties.I.toUpperCase();
    if (!getCountry(code)) return [];
    return [{ code, feature }];
  }).sort((a, b) => a.code.localeCompare(b.code));

/** Tracked countries the dart can never hit, because the topology has no
 * polygon for them. Exported so the UI can say so if it ever needs to, and
 * so the test can assert the list has not quietly grown. */
export const DART_UNREACHABLE: readonly string[] = COUNTRIES.filter(
  (c) => !DART_TARGETS.some((t) => t.code === c.code)
)
  .map((c) => c.code)
  .sort();

/** The guide cities, by the country they are in.
 *
 * Hand-written, because there is no coordinate or country field on a facts
 * file - but verifiable at a glance, which is the difference between this
 * and inventing 197 capital coordinates. The test asserts every one of the
 * 24 slugs appears here exactly once, so a new guide cannot be added
 * without landing in this table. */
const GUIDES_BY_COUNTRY: Readonly<Record<string, readonly SpinSlug[]>> = {
  AE: ["dubai"],
  AT: ["vienna"],
  BE: ["bruges", "brussels"],
  CZ: ["prague"],
  DE: ["berlin", "munich"],
  DK: ["copenhagen"],
  ES: ["barcelona", "madrid"],
  FR: ["paris"],
  GB: ["london"],
  GR: ["athens"],
  HU: ["budapest"],
  IT: ["florence", "rome", "venice"],
  JP: ["tokyo"],
  MX: ["mexico_city"],
  NL: ["amsterdam"],
  PT: ["lisbon"],
  SG: ["singapore"],
  TH: ["bangkok"],
  US: ["new_york"],
} as const;

/** The guides in this country, in the order they should be offered. Empty
 * when there is no guide for it, which is the common case and not an error -
 * the trip form plans anywhere. */
export function guidesForCountry(code: string): readonly SpinSlug[] {
  return GUIDES_BY_COUNTRY[code.toUpperCase()] ?? [];
}

// --- geometry ---------------------------------------------------------------

type Ring = [number, number][];

/** Every polygon of a feature, as rings. First ring of each is the outline,
 * the rest are holes (GeoJSON's own convention). */
function polygonsOf(geometry: GeoJSON.Geometry): Ring[][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as Ring[]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Ring[][];
  return [];
}

/** Ray casting. Counts crossings of a horizontal ray to the east; odd means
 * inside. Operates on raw lng/lat degrees, which is correct for a
 * country-sized shape and wrong only for a polygon that crosses the
 * antimeridian - see the note on sampleInside. */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point is inside this country, holes respected. */
export function isInsideCountry(lng: number, lat: number, feature: CountryFeature): boolean {
  for (const rings of polygonsOf(feature.geometry)) {
    if (rings.length === 0) continue;
    if (!inRing(lng, lat, rings[0])) continue;
    // Inside the outline - unless it is inside a hole of that outline.
    const inHole = rings.slice(1).some((hole) => inRing(lng, lat, hole));
    if (!inHole) return true;
  }
  return false;
}

function boundsOf(feature: CountryFeature): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const rings of polygonsOf(feature.geometry)) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return { minLng, maxLng, minLat, maxLat };
}

/** How many times to try for a point inside the outline before settling for
 * a point ON it.
 *
 * Rejection sampling in a bounding box is cheap and simple, and its worst
 * case is a country whose box is mostly other countries - Chile, Norway,
 * Indonesia. A few hundred attempts covers those; the fallback below covers
 * the rest and is still honest, because a vertex of the country's own
 * outline IS a point in that country. */
const SAMPLE_ATTEMPTS = 400;

/** A real point inside this country.
 *
 * Uniform in the bounding box rather than by area on the sphere: within one
 * country the difference is a slight lean toward the poleward edge, which is
 * invisible on a globe, and the honest property being kept here is "the dart
 * is inside the border it names", not "every square kilometre is equally
 * likely".
 *
 * A country whose polygon crosses the antimeridian (Russia, Fiji, the USA
 * via Alaska) gets a bounding box spanning nearly the whole world, so
 * rejection sampling mostly misses and the fallback does the work. That is a
 * worse dart, not a wrong one - it still lands inside the country. */
export function sampleInside(feature: CountryFeature, random: () => number): { lat: number; lng: number } {
  const { minLng, maxLng, minLat, maxLat } = boundsOf(feature);
  for (let i = 0; i < SAMPLE_ATTEMPTS; i++) {
    const lng = minLng + random() * (maxLng - minLng);
    const lat = minLat + random() * (maxLat - minLat);
    if (isInsideCountry(lng, lat, feature)) return { lat, lng };
  }
  // The largest polygon's first vertex: on the border, so in the country,
  // and deterministic rather than a guess.
  const polygons = polygonsOf(feature.geometry);
  let best: Ring | null = null;
  for (const rings of polygons) {
    if (rings.length > 0 && (best === null || rings[0].length > best.length)) best = rings[0];
  }
  if (best && best.length > 0) {
    const [lng, lat] = best[0];
    return { lat, lng };
  }
  return { lat: 0, lng: 0 };
}

/** One throw: a country chosen with an even chance each, and a point inside
 * it.
 *
 * Uniform per COUNTRY, not per square kilometre, and that is the deliberate
 * choice: this answers "I have no idea where to go", where San Marino
 * deserves the same shot as Russia. Weighting by area would make the dart a
 * geography lesson about Siberia. */
export function throwDart(random: () => number = Math.random): DartHit | null {
  if (DART_TARGETS.length === 0) return null;
  const target = DART_TARGETS[Math.floor(random() * DART_TARGETS.length)];
  if (!target) return null;
  const { lat, lng } = sampleInside(target.feature, random);
  return { code: target.code, lat, lng };
}

/** Every country the dart could pick, for the test and for anything that
 * wants to show the odds honestly. */
export function dartCountryCodes(): string[] {
  return DART_TARGETS.map((t) => t.code);
}

/** Re-exported so a caller does not need both modules to name a hit. */
export { SPIN_POOL };
