// Builds data/worldCities.json, the full city list behind the destination
// and origin fields (lib/worldCities.ts, /api/cities).
//
// The source is GeoNames (CC BY 4.0, credited on /privacy) as packaged by
// the all-the-cities npm module: every place with at least 1,000 people.
// Not a dependency of the site, because the site only ever reads the
// output; to rebuild:
//
//   npm i --no-save all-the-cities@3.1.0 && node scripts/buildWorldCities.mjs
//
// Each row is [name, country code, population, latitude, longitude] and,
// where the English name differs from the GeoNames one, the GeoNames name
// after that, so typing either finds it. The coordinates (to 2 decimals,
// about a kilometre) centre the hotel search on the trip's city. Sorted
// largest first, which is the order search results come back in. One row
// per name and country: GeoNames lists a few towns twice (a city and its
// district), and the larger one is the place a traveller means.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cities = require("all-the-cities");

// GeoNames names most cities in English already (Munich, Lisbon, Prague),
// but some by their local name. These are the ones a traveller would type
// in English and not find. The value is what goes into the trip brief.
const ENGLISH = {
  "Antwerpen|BE": "Antwerp",
  "Braunschweig|DE": "Brunswick",
  "Brugge|BE": "Bruges",
  "Chamonix-Mont-Blanc|FR": "Chamonix",
  "Donostia / San Sebastián|ES": "San Sebastián",
  "Frankfurt am Main|DE": "Frankfurt",
  "Fès|MA": "Fez",
  "Gent|BE": "Ghent",
  "Genève|CH": "Geneva",
  "Göteborg|SE": "Gothenburg",
  "Hannover|DE": "Hanover",
  "Köln|DE": "Cologne",
  "Luzern|CH": "Lucerne",
  "Mantova|IT": "Mantua",
  "Nürnberg|DE": "Nuremberg",
  "Padova|IT": "Padua",
  "Sevilla|ES": "Seville",
  "Siracusa|IT": "Syracuse",
};

const best = new Map();
for (const c of cities) {
  if (!c.name || c.population < 1000) continue;
  const key = `${c.name}|${c.country}`;
  const prev = best.get(key);
  if (!prev || c.population > prev.population) best.set(key, c);
}

const rows = [...best.values()]
  .sort((a, b) => b.population - a.population)
  .map((c) => {
    const english = ENGLISH[`${c.name}|${c.country}`];
    const [lng, lat] = c.loc.coordinates.map((v) => Math.round(v * 100) / 100);
    const row = [english ?? c.name, c.country, c.population, lat, lng];
    return english ? [...row, c.name] : row;
  });

const missing = Object.keys(ENGLISH).filter((key) => !best.has(key));
if (missing.length) throw new Error(`Not in the source any more: ${missing.join(", ")}`);

writeFileSync(new URL("../data/worldCities.json", import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} cities written`);
