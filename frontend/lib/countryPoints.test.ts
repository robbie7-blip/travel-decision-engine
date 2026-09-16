// The 29 hand-entered country points, checked as far as they can be.
//
// These are the only coordinates in this repository that came from memory
// rather than from a dataset, which makes them the ones most worth a real
// check. worldGeo.ts refused a second world dataset rather than hand-build a
// crosswalk it could not verify; the difference here is that these CAN be
// verified - not to the kilometre, but well enough to catch every mistake
// memory actually makes.
//
// The check: take each point, find the nearest country the topology DOES
// have a shape for, and assert it is a plausible neighbour. Vatican City has
// to come out inside Italy. Singapore has to come out next to Malaysia.
// Barbados has to come out in the eastern Caribbean and not the Indian
// Ocean. A swapped latitude and longitude, a dropped minus sign, a wrong
// hemisphere - all of those move a point thousands of kilometres and fail
// here. Being thirty kilometres out passes, and does not matter at globe
// zoom.
//
// What this cannot catch is a plausible near-miss that puts an island
// nation's marker just offshore. If one ever looks wrong on the globe,
// COUNTRY_POINTS is the place to look and one line is the whole fix.
//
// Run: npm run test:country-points

import { COUNTRY_POINTS, countryPoint, distanceKm } from "./countryPoints";
import { WORLD_COUNTRY_FEATURES } from "./worldGeo";
import { DART_POINT_ONLY, isInsideCountry } from "./dartGlobe";
import { COUNTRIES, getCountry } from "./countries";
import { check, finish, heading, section } from "./testutil";

heading("country points for the shapeless 29");

/** The nearest country with a real outline, and how far away it is.
 *
 * Distance to the nearest VERTEX of the polygon, which is close enough for
 * "is this in the right part of the world" and needs no projection. A point
 * inside a country reports that country at ~0. */
function nearestShape(lat: number, lng: number): { code: string; km: number } {
  let best = { code: "", km: Number.POSITIVE_INFINITY };
  for (const feature of WORLD_COUNTRY_FEATURES) {
    const geometry = feature.geometry;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    if (isInsideCountry(lng, lat, feature)) return { code: feature.properties.I.toUpperCase(), km: 0 };
    for (const rings of polygons) {
      for (const ring of rings) {
        for (const vertex of ring as [number, number][]) {
          const km = distanceKm({ lat, lng }, { lat: vertex[1], lng: vertex[0] });
          if (km < best.km) best = { code: feature.properties.I.toUpperCase(), km };
        }
      }
    }
  }
  return best;
}

/** What each point has to come out next to, and how far it is allowed to be.
 *
 * Written per country rather than as one global tolerance, because the
 * honest tolerance varies enormously: Vatican City is inside Italy, while
 * the nearest drawn shape to Tuvalu is most of a thousand kilometres of open
 * Pacific away. A single loose number would pass everything. */
const EXPECTED: Readonly<Record<string, { near: string[]; withinKm: number }>> = {
  // Enclosed by, or against, a country the topology draws. These come out
  // at 0km because the surrounding polygon contains them.
  AD: { near: ["FR", "ES"], withinKm: 5 },
  LI: { near: ["AT", "CH"], withinKm: 5 },
  MC: { near: ["FR"], withinKm: 5 },
  SM: { near: ["IT"], withinKm: 5 },
  VA: { near: ["IT"], withinKm: 5 },
  SG: { near: ["MY", "ID"], withinKm: 5 },

  // Measured distances, each checked against real geography rather than
  // taken from whatever the code happened to produce - Malta to Sicily is
  // about 90km, Bahrain sits roughly 25km off Saudi Arabia, Grenada is
  // about 140km from Trinidad, Palau about 890km from the Philippines.
  // The tolerance is just above the measured value, so a point that moves
  // fails rather than sliding under a generous global limit.
  MT: { near: ["IT", "TN"], withinKm: 150 },
  BH: { near: ["SA", "QA"], withinKm: 80 },
  KM: { near: ["MZ", "MG", "TZ"], withinKm: 400 },
  ST: { near: ["GA", "GQ", "CM"], withinKm: 350 },
  MV: { near: ["IN", "LK"], withinKm: 750 },
  CV: { near: ["SN", "MR", "GM"], withinKm: 800 },
  MU: { near: ["MG"], withinKm: 1000 },
  SC: { near: ["MG", "TZ", "SO"], withinKm: 1250 },

  // The eastern Caribbean. Guadeloupe and Martinique are NOT in the
  // topology - a first pass expected them and failed, which is the check
  // working: the coordinates were right and the expectation was wrong. The
  // nearest drawn shapes are Trinidad and Tobago, Puerto Rico and
  // Venezuela.
  GD: { near: ["TT", "VE"], withinKm: 200 },
  VC: { near: ["TT", "VE"], withinKm: 320 },
  BB: { near: ["TT", "VE"], withinKm: 350 },
  KN: { near: ["PR", "DO", "VE"], withinKm: 400 },
  LC: { near: ["TT", "VE"], withinKm: 420 },
  AG: { near: ["PR", "DO", "VE"], withinKm: 500 },
  DM: { near: ["TT", "PR", "VE"], withinKm: 570 },

  // Oceania - the loosest, because there is genuinely nothing drawn nearby.
  // Still tight enough that a swapped coordinate or a wrong hemisphere
  // fails by a wide margin, which is what these are for.
  TO: { near: ["FJ", "NZ"], withinKm: 850 },
  TV: { near: ["FJ", "SB", "KI"], withinKm: 950 },
  PW: { near: ["PH", "ID"], withinKm: 1000 },
  WS: { near: ["FJ", "TO"], withinKm: 1000 },
  NR: { near: ["SB", "PG", "KI"], withinKm: 1250 },
  FM: { near: ["PG", "ID", "PH"], withinKm: 1500 },
  KI: { near: ["SB", "TV", "FJ"], withinKm: 1900 },
  MH: { near: ["SB", "PG", "KI"], withinKm: 2250 },
};

function main() {
  {
    section("the table covers exactly the countries with no shape");

    const listed = Object.keys(COUNTRY_POINTS).sort();
    check(
      "a point for every shapeless country, and no others",
      JSON.stringify(listed) === JSON.stringify([...DART_POINT_ONLY].sort()),
      `table ${listed.length}, shapeless ${DART_POINT_ONLY.length}`
    );
    check("every code is a tracked country", listed.every((code) => getCountry(code) !== undefined));

    // A point for a country that HAS a shape would be a second source of
    // truth for the same place, and the two would drift.
    const shaped = new Set(WORLD_COUNTRY_FEATURES.map((f) => f.properties.I.toUpperCase()));
    const redundant = listed.filter((code) => shaped.has(code));
    check("no point duplicates a real outline", redundant.length === 0, JSON.stringify(redundant));

    check("the accessor is case-insensitive", countryPoint("sg") !== null);
    check("and returns null for a country with a shape", countryPoint("IT") === null);
    check("  and for an unknown code", countryPoint("ZZ") === null);
  }

  {
    section("every point is on the globe");

    for (const [code, point] of Object.entries(COUNTRY_POINTS)) {
      check(`${code} latitude is in range`, point.lat >= -90 && point.lat <= 90, String(point.lat));
      check(`${code} longitude is in range`, point.lng >= -180 && point.lng <= 180, String(point.lng));
      check(`${code} is finite`, Number.isFinite(point.lat) && Number.isFinite(point.lng));
      // Nothing here is at 0,0 - the null island, which is what a dropped
      // value looks like.
      check(`${code} is not null island`, Math.abs(point.lat) + Math.abs(point.lng) > 0.1);
    }
  }

  {
    section("every point comes out next to the right place");

    // The real check. A swapped lat/lng, a dropped minus, a wrong
    // hemisphere - each moves a point thousands of kilometres and fails.
    for (const [code, expected] of Object.entries(EXPECTED)) {
      const point = COUNTRY_POINTS[code];
      if (!point) {
        check(`${code} has a point to check`, false);
        continue;
      }
      const nearest = nearestShape(point.lat, point.lng);
      check(
        `${code} is nearest ${expected.near.join("/")} (got ${nearest.code} at ${Math.round(nearest.km)}km)`,
        expected.near.includes(nearest.code),
        `${nearest.code} @ ${Math.round(nearest.km)}km`
      );
      check(
        `  and within ${expected.withinKm}km of it`,
        nearest.km <= expected.withinKm,
        `${Math.round(nearest.km)}km`
      );
    }

    // Every point in the table has an expectation, so a new one cannot be
    // added without a check for it.
    const unchecked = Object.keys(COUNTRY_POINTS).filter((code) => !(code in EXPECTED));
    check("every point has an expectation", unchecked.length === 0, JSON.stringify(unchecked));
  }

  {
    section("a swapped coordinate really would fail");

    // The check is only worth having if it catches the mistake it is for.
    // Singapore with its latitude and longitude swapped is in the Indian
    // Ocean off Somalia, not beside Malaysia.
    const sg = COUNTRY_POINTS.SG;
    const swapped = nearestShape(sg.lng, sg.lat);
    check(
      "Singapore swapped is nowhere near Malaysia",
      EXPECTED.SG.near.includes(swapped.code) === false,
      `${swapped.code} @ ${Math.round(swapped.km)}km`
    );

    // And a dropped minus sign on a southern-hemisphere point.
    const mu = COUNTRY_POINTS.MU;
    const flipped = nearestShape(-mu.lat, mu.lng);
    check(
      "Mauritius with the sign dropped is not near Madagascar",
      EXPECTED.MU.near.includes(flipped.code) === false,
      `${flipped.code} @ ${Math.round(flipped.km)}km`
    );
  }

  {
    section("the gap this closes");

    // Before this table, these 29 were in the visited checklist and could
    // never appear on either map, because there is no shape to colour - a
    // traveller could tick Singapore and watch nothing happen. The data is
    // here now whether or not the maps use it yet.
    check("there are 29 of them", DART_POINT_ONLY.length === 29, String(DART_POINT_ONLY.length));
    check("all 197 tracked countries now have a position", DART_POINT_ONLY.length + WORLD_COUNTRY_FEATURES.filter((f) => getCountry(f.properties.I.toUpperCase())).length === COUNTRIES.length);
    for (const code of ["SG", "MT", "BB", "MV", "VA"]) {
      check(`${code} has one`, countryPoint(code) !== null);
    }
  }

  finish();
}

main();
