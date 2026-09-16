// A point for every country the world topology has no shape for.
//
// THE GAP THIS FILLS, which is older and wider than the dart. lib/worldGeo.ts
// carries 175 polygons; lib/countries.ts tracks 197 countries. The 29 in the
// middle are the microstates and small island nations - Singapore, Malta,
// Monaco, Barbados, the Maldives, most of Oceania - and the shortfall is not
// this app's doing: react-svg-worldmap's own bundled topology, which that
// file's data was extracted from, does not contain them either. Checked, not
// assumed: grepping the package for "SG", "MT", "MC", "VA" finds nothing.
//
// So a traveller who has been to Singapore can tick it in the visited
// checklist and it will never appear on the flat map or the globe, because
// there is no shape to colour. And the dart could not reach those 29 at all.
// One missing coordinate per country, two features held back.
//
// HOW MUCH TO TRUST THESE. They are hand-entered capital coordinates, which
// is exactly the kind of data this repo is otherwise careful not to invent -
// worldGeo.ts refused a second world dataset rather than hand-build a
// crosswalk it could not verify. The difference is that these CAN be
// verified, not exactly but well enough to catch the mistakes memory
// actually makes: a swapped latitude and longitude, a wrong hemisphere, a
// wrong ocean. countryPoints.test.ts takes each point, finds the nearest
// country the topology DOES have a shape for, and asserts it is a plausible
// neighbour - Vatican City must come out inside Italy, Singapore next to
// Malaysia, Barbados near the eastern Caribbean. A point that is 30km off
// passes and does not matter at globe zoom; a point in the wrong sea fails.
//
// What that check cannot catch is a plausible-looking error of a few dozen
// kilometres, which for an island nation could put a marker just offshore.
// If a dart marker ever sits in open water beside the country it names, this
// table is the place to look, and one corrected line is the whole fix.

export interface CountryPoint {
  lat: number;
  lng: number;
}

/** Capital coordinates, by ISO 3166-1 alpha-2. Only for countries the
 * topology has no polygon for - anything with a shape gets a real sampled
 * point instead, and adding a duplicate here would be a second source of
 * truth for the same country. */
export const COUNTRY_POINTS: Readonly<Record<string, CountryPoint>> = {
  // Europe's microstates. All five sit inside or against a country the
  // topology does have, which is what makes them the best-verified entries
  // in this table.
  AD: { lat: 42.51, lng: 1.52 }, // Andorra la Vella
  LI: { lat: 47.14, lng: 9.52 }, // Vaduz
  MC: { lat: 43.73, lng: 7.42 }, // Monaco
  SM: { lat: 43.94, lng: 12.45 }, // San Marino
  VA: { lat: 41.9, lng: 12.45 }, // Vatican City
  MT: { lat: 35.9, lng: 14.51 }, // Valletta

  // Asia and the Gulf.
  BH: { lat: 26.23, lng: 50.58 }, // Manama
  MV: { lat: 4.17, lng: 73.51 }, // Male
  SG: { lat: 1.35, lng: 103.82 }, // Singapore

  // Africa's island nations.
  CV: { lat: 14.93, lng: -23.51 }, // Praia
  KM: { lat: -11.7, lng: 43.26 }, // Moroni
  MU: { lat: -20.16, lng: 57.5 }, // Port Louis
  SC: { lat: -4.62, lng: 55.45 }, // Victoria
  ST: { lat: 0.34, lng: 6.73 }, // Sao Tome

  // The Caribbean.
  AG: { lat: 17.12, lng: -61.85 }, // St John's
  BB: { lat: 13.11, lng: -59.61 }, // Bridgetown
  DM: { lat: 15.3, lng: -61.39 }, // Roseau
  GD: { lat: 12.06, lng: -61.75 }, // St George's
  KN: { lat: 17.3, lng: -62.72 }, // Basseterre
  LC: { lat: 14.01, lng: -60.99 }, // Castries
  VC: { lat: 13.16, lng: -61.22 }, // Kingstown

  // Oceania. The least verifiable group in this table - the nearest shape
  // to Tuvalu or Nauru is hundreds of kilometres of open Pacific away - so
  // the test checks these against a generous region box rather than a
  // neighbour, and they are the first place to look if one looks wrong.
  FM: { lat: 6.92, lng: 158.16 }, // Palikir
  KI: { lat: 1.33, lng: 172.98 }, // Tarawa
  MH: { lat: 7.09, lng: 171.38 }, // Majuro
  NR: { lat: -0.53, lng: 166.92 }, // Yaren
  PW: { lat: 7.5, lng: 134.62 }, // Ngerulmud
  TO: { lat: -21.14, lng: -175.2 }, // Nuku'alofa
  TV: { lat: -8.52, lng: 179.2 }, // Funafuti
  WS: { lat: -13.83, lng: -171.77 }, // Apia
};

/** The point for this country, or null when the topology has a real shape
 * for it and a sampled point is the better answer. */
export function countryPoint(code: string): CountryPoint | null {
  return COUNTRY_POINTS[code.toUpperCase()] ?? null;
}

/** Great-circle distance in kilometres. Used by the test to check each point
 * against the nearest real shape, and exported because "how far is this from
 * anything we can draw" is the only handle anyone has on whether a
 * hand-entered coordinate is sane. */
export function distanceKm(a: CountryPoint, b: CountryPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
