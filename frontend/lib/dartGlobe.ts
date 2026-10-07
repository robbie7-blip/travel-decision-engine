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
// EVERY TRACKED COUNTRY IS REACHABLE. That was not true at first: 29 of the
// 197 have no polygon in the topology - the microstates and small island
// nations, Singapore among them - and the first version simply could not hit
// them. The same missing coordinate also meant those 29 could never be
// coloured in on the visited maps, a gap older and wider than this feature,
// so lib/countryPoints.ts fills it once for both. Those 29 get a fixed
// capital coordinate rather than a sampled point, since there is no outline
// to sample from; countryPoints.test.ts checks each one against the nearest
// shape the topology DOES have, which catches a swapped lat/lng or a wrong
// ocean even though it cannot catch being thirty kilometres out.
//
// Run: npm run test:dart-globe

import { WORLD_COUNTRY_FEATURES, type CountryFeature } from "./worldGeo";
import { COUNTRIES, getCountry } from "./countries";
import { countryPoint } from "./countryPoints";
import { SPIN_POOL, type SpinSlug } from "./spin";

/** How long the dart is in the air, and how long the page waits before
 * giving up on it.
 *
 * Here rather than beside the animation, because two components depend on
 * the same number and they are in different files. DartGlobeCanvas flies
 * the dart for this long; GlobeDart runs a backstop that reveals the
 * result if the canvas never reports back - and that backstop MUST outlast
 * the flight, or the result card appears while the dart is still falling.
 *
 * It did not, quite, by luck: a 1600ms flight against a hardcoded 4000ms
 * backstop. Nothing said they were related, so the next person to make the
 * throw more dramatic would have broken it with no test to catch them and
 * no symptom other than the card arriving early.
 */
/** What the globe may show about the landing, given whether the dart is
 * still in the air.
 *
 * Null during the flight. Three different things on the globe answer the
 * question the throw is asking - the country's colour, the stuck pin, and
 * the impact ring - and every one of them was originally written against
 * the hit itself, which exists from the first frame of the throw. Fixing
 * them one at a time went badly: the pin and the ring were gated when the
 * dart animation went in, the country's colour was missed, and the result
 * was a dart falling toward a country that had already turned green and
 * announced the answer.
 *
 * So the rule is one function with one test rather than three call sites
 * each remembering it. */
export function revealedHit<T>(hit: T | null, flying: boolean): T | null {
  return flying ? null : hit;
}

export function dartFlightMs(reducedMotion: boolean): number {
  // Slow enough to watch, which is the whole point of animating it. 1600
  // was over before it read as a throw; 2400 was still being called quick
  // by the person watching it on a phone, which is the only measurement
  // that counts for this.
  return reducedMotion ? 450 : 3200;
}

/** The flight, plus room for a slow device to finish rendering it.
 *
 * Derived rather than written down, so it cannot fall behind the flight.
 * Scaled from the actual duration in play, so someone who asked for
 * reduced motion is not left waiting four seconds for a backstop on a
 * 450ms animation. */
export function dartBackstopMs(reducedMotion: boolean): number {
  return dartFlightMs(reducedMotion) + 1600;
}

export interface DartHit {
  /** ISO 3166-1 alpha-2 of the country the dart stuck in. */
  code: string;
  lat: number;
  lng: number;
  /** False for the 29 countries with no polygon, where the point is a fixed
   * capital coordinate rather than one sampled inside an outline.
   *
   * Carried rather than inferred because it is the difference between two
   * different promises: "the dart is inside this border" and "the dart is at
   * this country". The first is what the suite proves for the other 168; the
   * second is all that can be promised without a shape, and a caller that
   * highlights the country on the globe needs to know there is nothing to
   * highlight. */
  insideBorder: boolean;
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

/** Every tracked country that has a polygon, with it. */
export const DART_SHAPES: readonly { code: string; feature: CountryFeature }[] =
  WORLD_COUNTRY_FEATURES.flatMap((feature) => {
    const code = feature.properties.I.toUpperCase();
    if (!getCountry(code)) return [];
    return [{ code, feature }];
  }).sort((a, b) => a.code.localeCompare(b.code));

/** Every tracked country, whether its position comes from an outline or
 * from a fixed point. The dart draws from this, so the whole list is
 * reachable - which is the point. */
export const DART_TARGETS: readonly string[] = COUNTRIES.map((c) => c.code).sort();

/** The countries positioned by a fixed capital coordinate because the
 * topology has no outline for them. Exported so the test can assert the
 * two sets together account for every tracked country, and neither has
 * quietly grown. */
export const DART_POINT_ONLY: readonly string[] = COUNTRIES.filter(
  (c) => !DART_SHAPES.some((t) => t.code === c.code)
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
  const code = DART_TARGETS[Math.floor(random() * DART_TARGETS.length)];
  if (!code) return null;
  return hitFor(code, random);
}

/** Where the dart lands for a given country. Split out from throwDart so
 * the test can ask about a specific country rather than throwing until it
 * comes up. */
export function hitFor(code: string, random: () => number = Math.random): DartHit | null {
  const shape = DART_SHAPES.find((t) => t.code === code);
  if (shape) {
    const { lat, lng } = sampleInside(shape.feature, random);
    return { code, lat, lng, insideBorder: true };
  }
  const point = countryPoint(code);
  if (point) return { code, lat: point.lat, lng: point.lng, insideBorder: false };
  return null;
}

/** Every country the dart could pick, for the test and for anything that
 * wants to show the odds honestly. */
export function dartCountryCodes(): string[] {
  return [...DART_TARGETS];
}

/** Re-exported so a caller does not need both modules to name a hit. */
export { SPIN_POOL };

// ---------------------------------------------------------------------------
// The throw itself.
//
// WHAT WAS WRONG WITH THE OLD ONE, measured rather than guessed. The dart
// fell straight down the radius to the landing point while the camera
// looked at that same point from directly above it - so the viewer saw the
// dart end-on, from behind, for the whole flight. Rendered frame by frame
// against a stand-in globe at the real altitudes, the dart was INVISIBLE
// for the first 70% of the flight and a four-pixel dot for the rest. Every
// complaint about the throw being "quick" was really this: there was
// almost nothing on screen to see.
//
// So the dart now comes in on an arc from off to one side, and the
// geometry below is what makes that work:
//
//   - It is seen side-on for most of its flight, which is the only angle
//     at which a dart reads as a dart.
//   - It lands at an angle and stays there, like a dart in a board, rather
//     than sticking straight out at the lens.
//   - It flies in the LAST HALF of the window. The camera spends the first
//     half swinging round to the hit, and nothing near the landing point is
//     on screen until it gets there - a dart thrown before that is thrown
//     off-camera. Two beats, "look there" then "throw", instead of one
//     beat with the interesting half invisible.
//   - Every distance scales with how close the camera finishes, because it
//     finishes at 0.9 radii for a country with an outline and 0.35 for one
//     without (Monaco, Tuvalu). A dart sized for the first is three times
//     too big for the second.
//
// Kept here, as plain {x,y,z} arithmetic with no three.js, so it can be
// tested. The sweep in dartGlobe.test.ts checks the path never passes
// through the globe at any latitude - which is not obvious by inspection
// and is exactly what a nudge to DART_SIDE_ANGLE would break.

/** A point in react-globe.gl's scene, whose globe has radius 100. */
export type DartVec3 = { x: number; y: number; z: number };

/** react-globe.gl's fixed internal globe radius. Not configurable by the
 * library's API; the dart's own dimensions in DartGlobeCanvas are written
 * against it too. */
export const GLOBE_RADIUS = 100;

/** When the dart appears, as a fraction of the flight window.
 *
 * The camera is still swinging before this. Throwing earlier means
 * throwing it where nobody is looking. */
export const DART_THROW_AT = 0.45;

/** When the tip reaches the surface. The rest of the window is the dart
 * shuddering to a stop, which is the part that makes it land rather than
 * simply arrive. */
export const DART_LAND_AT = 0.93;

/** The angle between the dart and straight-down at the moment it lands,
 * in radians. 1.3 is about 75 degrees off vertical: enough to show its
 * whole length to a camera looking straight down, while still reading as
 * stuck in rather than laid on top. Compared against 0.95 and 1.45 by
 * rendering the landing; 0.95 was too foreshortened and 1.45 looked like
 * it had skidded. */
export const DART_LAND_ANGLE = 1.3;

/** Which way it comes from, as an angle in the landing point's own tangent
 * plane: 0 is local north, positive turns east. Fixed rather than random,
 * so the throw looks the same every time and reads as one gesture.
 *
 * Expressed in the TANGENT PLANE and not as a latitude/longitude offset,
 * which is the version that had a bug in it: near a pole a latitude offset
 * clamps away to nothing and a longitude offset collapses, leaving the
 * start point directly above the target. The direction of travel then has
 * no sideways component, and normalising it produces NaN - a dart that
 * vanishes, in whichever country happens to be furthest north. */
export const DART_SIDE_ANGLE = -0.5;

/** The altitude the dart's proportions are quoted at, so everything else
 * can scale from it. Matches HIT_ALTITUDE in DartGlobeCanvas. */
export const DART_REFERENCE_ALTITUDE = 0.9;

/** How far the dart starts above and to the side of the target, in globe
 * radii at the reference altitude. Just outside the frame, so it flies in
 * rather than appearing in the middle of it. */
export const DART_START_UP = 0.55;
export const DART_START_SIDE = 0.3;

/** How much of the approach is straight. The control point sits this far
 * back along the incoming direction, which is what sets the landing angle
 * exactly: a quadratic's tangent at the end is the vector from its control
 * point to its end. */
export const DART_CONTROL_FRACTION = 0.55;

/** Turns about its own axis during the flight. */
export const DART_SPIN_TURNS = 1.5;

/** The shudder after it lands: how far the tail swings, how fast, and how
 * sharply that dies away. */
export const DART_QUIVER_RADIANS = 0.08;
export const DART_QUIVER_CYCLES = 3;

function vec(x: number, y: number, z: number): DartVec3 {
  return { x, y, z };
}
function add(a: DartVec3, b: DartVec3): DartVec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}
function sub(a: DartVec3, b: DartVec3): DartVec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}
function scale(a: DartVec3, s: number): DartVec3 {
  return vec(a.x * s, a.y * s, a.z * s);
}
function dot(a: DartVec3, b: DartVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: DartVec3, b: DartVec3): DartVec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
export function dartVecLength(a: DartVec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function normalise(a: DartVec3): DartVec3 {
  const length = dartVecLength(a);
  if (length === 0) throw new Error("cannot normalise a zero vector");
  return scale(a, 1 / length);
}

/** How big to draw the dart so it takes up the same part of the frame
 * whatever altitude the camera finishes at.
 *
 * Apparent size goes as length over distance, and at the landing the
 * camera is `altitude` radii above the surface - so length has to go with
 * altitude. Without this the dart is right for Brazil and, for Monaco,
 * longer than the gap between the camera and the ground. */
export function dartThrowScale(altitude: number, baseScale: number): number {
  return (baseScale * altitude) / DART_REFERENCE_ALTITUDE;
}

export type DartFlightPath = {
  start: DartVec3;
  control: DartVec3;
  end: DartVec3;
};

/** The arc the dart travels, from the landing point outward.
 *
 * `end` is where the tip finishes - a point just above the surface, which
 * the caller gets from the globe's own getCoords so the two agree about
 * where a latitude is. `altitude` is where the camera finishes, which is
 * what every distance here is scaled by. */
export function dartFlightPath(end: DartVec3, altitude: number): DartFlightPath {
  const outward = normalise(end);
  // A tangent frame at the landing point. The reference vector is swapped
  // near the poles because the cross product with something parallel is
  // zero - the degenerate case the comment on DART_SIDE_ANGLE describes.
  const reference = Math.abs(outward.y) > 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
  const east = normalise(cross(reference, outward));
  const north = normalise(cross(outward, east));
  const side = normalise(
    add(scale(north, Math.cos(DART_SIDE_ANGLE)), scale(east, Math.sin(DART_SIDE_ANGLE)))
  );

  const ratio = altitude / DART_REFERENCE_ALTITUDE;
  const start = add(
    scale(outward, GLOBE_RADIUS * (1 + DART_START_UP * ratio)),
    scale(side, GLOBE_RADIUS * DART_START_SIDE * ratio)
  );

  // The incoming direction: mostly down, partly along the way it came, at
  // exactly DART_LAND_ANGLE off vertical.
  const chord = sub(end, start);
  const alongSurface = normalise(sub(chord, scale(outward, dot(chord, outward))));
  const incoming = normalise(
    add(
      scale(scale(outward, -1), Math.cos(DART_LAND_ANGLE)),
      scale(alongSurface, Math.sin(DART_LAND_ANGLE))
    )
  );
  const control = sub(
    end,
    scale(incoming, dartVecLength(chord) * DART_CONTROL_FRACTION)
  );
  return { start, control, end };
}

export function dartPointAt(path: DartFlightPath, eased: number): DartVec3 {
  const k = 1 - eased;
  return add(
    add(scale(path.start, k * k), scale(path.control, 2 * k * eased)),
    scale(path.end, eased * eased)
  );
}

/** Where the dart is pointing: the curve's own derivative, so the nose
 * follows the direction of travel instead of always aiming at the globe's
 * centre. Exact, and never zero-length, which a difference between two
 * sampled points would be at the end of the flight. */
export function dartTangentAt(path: DartFlightPath, eased: number): DartVec3 {
  return add(
    scale(sub(path.control, path.start), 2 * (1 - eased)),
    scale(sub(path.end, path.control), 2 * eased)
  );
}

export type DartFlightFrame = {
  /** False while the camera is still swinging, before the throw. */
  visible: boolean;
  /** Position along the arc, 0 at the throw and 1 at the surface. */
  eased: number;
  /** True once the tip is in. */
  landed: boolean;
  /** Radians about the dart's own axis. */
  spin: number;
  /** Radians the tail swings by, after landing. */
  quiver: number;
};

/** The whole flight as a function of time, so nothing about the animation
 * lives only inside a requestAnimationFrame callback where it cannot be
 * tested. `t` is 0 to 1 across the window dartFlightMs returns. */
export function dartFlightFrame(t: number): DartFlightFrame {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < DART_THROW_AT) {
    return { visible: false, eased: 0, landed: false, spin: 0, quiver: 0 };
  }
  const raw = Math.min(1, (clamped - DART_THROW_AT) / (DART_LAND_AT - DART_THROW_AT));
  // Fast off the hand, easing into the board. The old animation used t*t,
  // which accelerates - and so spent most of its time far away, where a
  // dart is a dot, and crossed the part you can actually see in a blink.
  const eased = 1 - Math.pow(1 - raw, 1.7);
  const landed = clamped >= DART_LAND_AT;
  const after = landed ? (clamped - DART_LAND_AT) / (1 - DART_LAND_AT) : 0;
  return {
    visible: true,
    eased,
    landed,
    spin: eased * Math.PI * 2 * DART_SPIN_TURNS,
    // Damped, and squared so it is unmistakably finished by the time the
    // result card appears rather than still twitching under it.
    quiver: landed
      ? DART_QUIVER_RADIANS *
        Math.sin(after * Math.PI * 2 * DART_QUIVER_CYCLES) *
        (1 - after) ** 2
      : 0,
  };
}
