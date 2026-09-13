// The city suggestions behind the destinations field.
//
// WHY THIS IS A COMBOBOX AND NOT A <select>. The airport field could be a
// closed dropdown because the question it asks is closed: Rome has exactly
// two airports and lib/airports.ts knows both. "Where are you going" is not
// closed. A <select> here would mean nobody can plan a trip to Tbilisi, and
// the engine's whole premise is that it will plan a trip to Tbilisi. So the
// field suggests, filters and inserts on click - and still accepts anything
// typed, exactly as it did when it was a bare text input.
//
// WHERE THE LIST COMES FROM. Not a top-forty picked by taste: the union of
// the two sets of cities this product already knows something EXTRA about -
// the 24 with curated facts files (facts/*.json, which feed the prompt) and
// the 31 in the airport table (lib/airports.ts, which have more than one
// airport and therefore change the plan). Suggesting those first is
// suggesting the cities where the itinerary is measurably better informed,
// which is a real signal rather than a guess at popularity.
//
// Declared here as a static list rather than read from facts/*.json, because
// lib/destinations.ts does that with node:fs and this module is imported by
// a client component.
//
// THE VALUE IS ALWAYS THE ENGLISH NAME. Same rule destinationCityNamesBg.ts
// already states for the guide pages: the canonical English name is what the
// engine matches destination strings against (airportsFor, the curated-facts
// lookup, the model prompt), so a Bulgarian label is display only. Picking
// "Рим" puts "Rome" in the brief, which is how a Bulgarian traveller gets
// the Fiumicino/Ciampino dropdown that typing "Рим" by hand never produced.
//
// Run: npm run test:city-options

import { DESTINATION_CITY_NAMES_BG } from "./destinationCityNamesBg";
import type { Language } from "./types";

export interface CityOption {
  /** The canonical English name, and the value written into the brief. */
  name: string;
  /** Country, for disambiguation in the list only - never part of the
   * value. "Venice" and "Venice, Italy" would be two different destination
   * strings to the engine. */
  country: string;
}

/** The cities with curated facts files, by the slug those files use, so the
 * Bulgarian labels below can be looked up from the map the guide pages
 * already use rather than re-typed. */
const CURATED: { slug: string; name: string; country: string }[] = [
  { slug: "amsterdam", name: "Amsterdam", country: "Netherlands" },
  { slug: "athens", name: "Athens", country: "Greece" },
  { slug: "bangkok", name: "Bangkok", country: "Thailand" },
  { slug: "barcelona", name: "Barcelona", country: "Spain" },
  { slug: "berlin", name: "Berlin", country: "Germany" },
  { slug: "bruges", name: "Bruges", country: "Belgium" },
  { slug: "brussels", name: "Brussels", country: "Belgium" },
  { slug: "budapest", name: "Budapest", country: "Hungary" },
  { slug: "copenhagen", name: "Copenhagen", country: "Denmark" },
  { slug: "dubai", name: "Dubai", country: "United Arab Emirates" },
  { slug: "florence", name: "Florence", country: "Italy" },
  { slug: "lisbon", name: "Lisbon", country: "Portugal" },
  { slug: "london", name: "London", country: "United Kingdom" },
  { slug: "madrid", name: "Madrid", country: "Spain" },
  { slug: "mexico_city", name: "Mexico City", country: "Mexico" },
  { slug: "munich", name: "Munich", country: "Germany" },
  { slug: "new_york", name: "New York", country: "United States" },
  { slug: "paris", name: "Paris", country: "France" },
  { slug: "prague", name: "Prague", country: "Czechia" },
  { slug: "rome", name: "Rome", country: "Italy" },
  { slug: "singapore", name: "Singapore", country: "Singapore" },
  { slug: "tokyo", name: "Tokyo", country: "Japan" },
  { slug: "venice", name: "Venice", country: "Italy" },
  { slug: "vienna", name: "Vienna", country: "Austria" },
];

/** The multi-airport cities from lib/airports.ts that are not already
 * curated above. Their names are spelled exactly as that table's keys, so a
 * pick always resolves to an airport list. */
const MULTI_AIRPORT_ONLY: { name: string; country: string }[] = [
  { name: "Beijing", country: "China" },
  { name: "Buenos Aires", country: "Argentina" },
  { name: "Chicago", country: "United States" },
  { name: "Frankfurt", country: "Germany" },
  { name: "Istanbul", country: "Türkiye" },
  { name: "Jakarta", country: "Indonesia" },
  { name: "Kuala Lumpur", country: "Malaysia" },
  { name: "Los Angeles", country: "United States" },
  { name: "Milan", country: "Italy" },
  { name: "Osaka", country: "Japan" },
  { name: "Oslo", country: "Norway" },
  { name: "Rio de Janeiro", country: "Brazil" },
  { name: "Sao Paulo", country: "Brazil" },
  { name: "Seoul", country: "South Korea" },
  { name: "Shanghai", country: "China" },
  { name: "Stockholm", country: "Sweden" },
  { name: "Taipei", country: "Taiwan" },
  { name: "Toronto", country: "Canada" },
  { name: "Washington", country: "United States" },
];

export const CITY_OPTIONS: CityOption[] = [
  ...CURATED.map(({ name, country }) => ({ name, country })),
  ...MULTI_AIRPORT_ONLY,
].sort((a, b) => a.name.localeCompare(b.name, "en"));

/** Bulgarian labels, for the cities that HAVE a reviewed one.
 *
 * Only the 24 from destinationCityNamesBg.ts, which someone who reads
 * Bulgarian wrote. The 19 airport-only cities fall back to their English
 * name rather than getting a transliteration invented here - a wrong
 * Bulgarian name shown to a Bulgarian reader is worse than an English one,
 * and filling them in is a one-line edit per city in that file plus an
 * entry here. */
const BG_BY_NAME: Record<string, string> = Object.fromEntries(
  CURATED.flatMap(({ slug, name }) => {
    const bg = DESTINATION_CITY_NAMES_BG[slug];
    return bg ? [[name, bg] as const] : [];
  })
);

/** What to show for this option. Never what to store - see the header. */
export function cityLabel(option: CityOption, language: Language): string {
  if (language !== "bg") return option.name;
  return BG_BY_NAME[option.name] ?? option.name;
}

/** Folds diacritics and case so "Sao" finds "São" and "istanbul" finds
 * "Istanbul". Same NFD approach lib/airports.ts uses for its own lookups. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** The suggestions to show for what has been typed so far.
 *
 * Matches on the English name, the country, AND the Bulgarian label, so a
 * Bulgarian reader can type either "Рим" or "Rome" and a traveller who only
 * remembers the country can type "Italy" and get Florence, Milan, Rome and
 * Venice.
 *
 * Prefix matches come before contained matches - typing "ven" should offer
 * Venice before Vienna, and "or" should not put Toronto above anything that
 * starts with it. Already-chosen cities are excluded rather than shown
 * greyed out: the field is additive, and an option that does nothing when
 * clicked is worse than no option.
 */
export function filterCityOptions(
  query: string,
  language: Language,
  chosen: string[] = [],
  limit = 8
): CityOption[] {
  const taken = new Set(chosen.map(fold));
  const available = CITY_OPTIONS.filter((option) => !taken.has(fold(option.name)));
  const q = fold(query);
  if (!q) return available.slice(0, limit);

  const prefix: CityOption[] = [];
  const contains: CityOption[] = [];
  for (const option of available) {
    // The country matches by PREFIX only, while the city names also match
    // anywhere inside. Substring-matching the country made short queries
    // useless: "an" offered Amsterdam, Berlin and Munich, because
    // "Netherlands" and "Germany" both contain "an" - three cities whose
    // own names have nothing to do with what was typed. Found by a test
    // asserting the ordering and reading the actual output.
    const cityNames = [fold(option.name), fold(cityLabel(option, language))];
    const country = fold(option.country);
    if (cityNames.some((h) => h.startsWith(q)) || country.startsWith(q)) prefix.push(option);
    else if (cityNames.some((h) => h.includes(q))) contains.push(option);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** The destinations field's value, as a list.
 *
 * The brief has always carried destinations as one comma-separated string
 * and validation.ts splits it the same way, so the chips are a view over
 * that string rather than a new shape - which keeps the ?dest= deep link
 * from the guide pages, flight import, and every stored form state working
 * untouched. */
export function splitCities(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** ...and back, in the one format the rest of the app already reads. */
export function joinCities(cities: string[]): string {
  return cities.join(", ");
}

/** Adds a city to the list, or returns it unchanged.
 *
 * Refuses a duplicate case-insensitively and after folding, because "rome"
 * and "Rome" are one destination to the engine and two chips to the eye -
 * and a duplicated destination is a real defect downstream: it would put
 * the same city in the brief twice and let the plan spend days on it twice.
 */
export function addCity(cities: string[], city: string): string[] {
  const trimmed = city.trim();
  if (!trimmed) return cities;
  if (cities.some((existing) => fold(existing) === fold(trimmed))) return cities;
  return [...cities, trimmed];
}
