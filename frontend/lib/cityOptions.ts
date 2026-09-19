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
  { name: "Istanbul", country: "Turkey" },
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


/** The cities people actually type.
 *
 * WHY THIS LIST EXISTS. Before it, the suggestions were the 24 curated
 * cities plus the 19 above - not a list of places travelers name, but two
 * other lists glued together, one drawn from the facts corpus and one from
 * the airport table. Nobody had ever written the list this field needs.
 *
 * It showed: typing "Sofia" - this product's own example origin, in a
 * product that ships in Bulgarian - offered nothing and said "not on the
 * list". For the one field where the answer is usually the traveler's own
 * home city, the suggestion list was silent about most of Europe.
 *
 * WHAT IT IS NOT. It is not every city, and it cannot be: there is no
 * closed list of places a person might leave from or go to, which is why
 * the free-text path exists and stays (see the header of this file, and
 * CityCombobox). A suggestion list does not have to be exhaustive. It has
 * to not be embarrassing - and being unable to offer a European capital
 * was embarrassing.
 *
 * SO: every European capital, the European cities with real airports that
 * people fly from, and the rest of the world weighted to where travelers
 * go. Europe-heavy on purpose, because that is this product's market.
 *
 * EVERY COUNTRY HERE IS VALIDATED against lib/countries.ts, by the suite,
 * rather than trusted. A hand-written list of a few hundred cities is
 * exactly where a wrong country slips in, and "Sofia, Romania" in a travel
 * product is worse than no suggestion at all. That check immediately
 * caught one that predates this list: Istanbul was filed under "Türkiye",
 * which is not the spelling the rest of the app uses.
 *
 * English names only, and the Bulgarian labels below deliberately do NOT
 * grow to match - same reasoning as the 19 above, which is already written
 * out there: a transliteration invented here and shown to a Bulgarian
 * reader is worse than the English name. */
const COMMON_DESTINATIONS: { name: string; country: string }[] = [
  { name: "Sofia", country: "Bulgaria" },
  { name: "Plovdiv", country: "Bulgaria" },
  { name: "Varna", country: "Bulgaria" },
  { name: "Burgas", country: "Bulgaria" },
  { name: "Tirana", country: "Albania" },
  { name: "Andorra la Vella", country: "Andorra" },
  { name: "Yerevan", country: "Armenia" },
  { name: "Baku", country: "Azerbaijan" },
  { name: "Minsk", country: "Belarus" },
  { name: "Sarajevo", country: "Bosnia and Herzegovina" },
  { name: "Zagreb", country: "Croatia" },
  { name: "Nicosia", country: "Cyprus" },
  { name: "Tallinn", country: "Estonia" },
  { name: "Helsinki", country: "Finland" },
  { name: "Tbilisi", country: "Georgia" },
  { name: "Reykjavik", country: "Iceland" },
  { name: "Dublin", country: "Ireland" },
  { name: "Pristina", country: "Kosovo" },
  { name: "Riga", country: "Latvia" },
  { name: "Vaduz", country: "Liechtenstein" },
  { name: "Vilnius", country: "Lithuania" },
  { name: "Luxembourg", country: "Luxembourg" },
  { name: "Valletta", country: "Malta" },
  { name: "Chisinau", country: "Moldova" },
  { name: "Monaco", country: "Monaco" },
  { name: "Podgorica", country: "Montenegro" },
  { name: "Skopje", country: "North Macedonia" },
  { name: "Warsaw", country: "Poland" },
  { name: "Bucharest", country: "Romania" },
  { name: "San Marino", country: "San Marino" },
  { name: "Belgrade", country: "Serbia" },
  { name: "Bratislava", country: "Slovakia" },
  { name: "Ljubljana", country: "Slovenia" },
  { name: "Bern", country: "Switzerland" },
  { name: "Kyiv", country: "Ukraine" },
  { name: "Ankara", country: "Turkey" },
  { name: "Manchester", country: "United Kingdom" },
  { name: "Birmingham", country: "United Kingdom" },
  { name: "Edinburgh", country: "United Kingdom" },
  { name: "Glasgow", country: "United Kingdom" },
  { name: "Liverpool", country: "United Kingdom" },
  { name: "Bristol", country: "United Kingdom" },
  { name: "Leeds", country: "United Kingdom" },
  { name: "Newcastle", country: "United Kingdom" },
  { name: "Belfast", country: "United Kingdom" },
  { name: "Cork", country: "Ireland" },
  { name: "Zurich", country: "Switzerland" },
  { name: "Geneva", country: "Switzerland" },
  { name: "Basel", country: "Switzerland" },
  { name: "Salzburg", country: "Austria" },
  { name: "Innsbruck", country: "Austria" },
  { name: "Graz", country: "Austria" },
  { name: "Hamburg", country: "Germany" },
  { name: "Cologne", country: "Germany" },
  { name: "Düsseldorf", country: "Germany" },
  { name: "Stuttgart", country: "Germany" },
  { name: "Nuremberg", country: "Germany" },
  { name: "Leipzig", country: "Germany" },
  { name: "Dresden", country: "Germany" },
  { name: "Hannover", country: "Germany" },
  { name: "Lyon", country: "France" },
  { name: "Marseille", country: "France" },
  { name: "Nice", country: "France" },
  { name: "Toulouse", country: "France" },
  { name: "Bordeaux", country: "France" },
  { name: "Nantes", country: "France" },
  { name: "Strasbourg", country: "France" },
  { name: "Lille", country: "France" },
  { name: "Naples", country: "Italy" },
  { name: "Turin", country: "Italy" },
  { name: "Bologna", country: "Italy" },
  { name: "Pisa", country: "Italy" },
  { name: "Bari", country: "Italy" },
  { name: "Palermo", country: "Italy" },
  { name: "Catania", country: "Italy" },
  { name: "Verona", country: "Italy" },
  { name: "Genoa", country: "Italy" },
  { name: "Seville", country: "Spain" },
  { name: "Valencia", country: "Spain" },
  { name: "Malaga", country: "Spain" },
  { name: "Bilbao", country: "Spain" },
  { name: "Alicante", country: "Spain" },
  { name: "Palma", country: "Spain" },
  { name: "Porto", country: "Portugal" },
  { name: "Faro", country: "Portugal" },
  { name: "Funchal", country: "Portugal" },
  { name: "Rotterdam", country: "Netherlands" },
  { name: "Eindhoven", country: "Netherlands" },
  { name: "Utrecht", country: "Netherlands" },
  { name: "The Hague", country: "Netherlands" },
  { name: "Antwerp", country: "Belgium" },
  { name: "Ghent", country: "Belgium" },
  { name: "Krakow", country: "Poland" },
  { name: "Gdansk", country: "Poland" },
  { name: "Wroclaw", country: "Poland" },
  { name: "Poznan", country: "Poland" },
  { name: "Katowice", country: "Poland" },
  { name: "Brno", country: "Czechia" },
  { name: "Debrecen", country: "Hungary" },
  { name: "Thessaloniki", country: "Greece" },
  { name: "Heraklion", country: "Greece" },
  { name: "Rhodes", country: "Greece" },
  { name: "Corfu", country: "Greece" },
  { name: "Santorini", country: "Greece" },
  { name: "Split", country: "Croatia" },
  { name: "Dubrovnik", country: "Croatia" },
  { name: "Zadar", country: "Croatia" },
  { name: "Cluj-Napoca", country: "Romania" },
  { name: "Timisoara", country: "Romania" },
  { name: "Gothenburg", country: "Sweden" },
  { name: "Malmo", country: "Sweden" },
  { name: "Bergen", country: "Norway" },
  { name: "Stavanger", country: "Norway" },
  { name: "Trondheim", country: "Norway" },
  { name: "Aarhus", country: "Denmark" },
  { name: "Tampere", country: "Finland" },
  { name: "Kaunas", country: "Lithuania" },
  { name: "Lviv", country: "Ukraine" },
  { name: "Odesa", country: "Ukraine" },
  { name: "Izmir", country: "Turkey" },
  { name: "Antalya", country: "Turkey" },
  { name: "Bodrum", country: "Turkey" },
  { name: "Kyoto", country: "Japan" },
  { name: "Sapporo", country: "Japan" },
  { name: "Fukuoka", country: "Japan" },
  { name: "Busan", country: "South Korea" },
  { name: "Hong Kong", country: "China" },
  { name: "Guangzhou", country: "China" },
  { name: "Shenzhen", country: "China" },
  { name: "Chengdu", country: "China" },
  { name: "Xi'an", country: "China" },
  { name: "Hanoi", country: "Vietnam" },
  { name: "Ho Chi Minh City", country: "Vietnam" },
  { name: "Da Nang", country: "Vietnam" },
  { name: "Phnom Penh", country: "Cambodia" },
  { name: "Siem Reap", country: "Cambodia" },
  { name: "Vientiane", country: "Laos" },
  { name: "Yangon", country: "Myanmar" },
  { name: "Chiang Mai", country: "Thailand" },
  { name: "Phuket", country: "Thailand" },
  { name: "Krabi", country: "Thailand" },
  { name: "Manila", country: "Philippines" },
  { name: "Cebu", country: "Philippines" },
  { name: "Denpasar", country: "Indonesia" },
  { name: "Ubud", country: "Indonesia" },
  { name: "Delhi", country: "India" },
  { name: "Mumbai", country: "India" },
  { name: "Bangalore", country: "India" },
  { name: "Chennai", country: "India" },
  { name: "Kolkata", country: "India" },
  { name: "Jaipur", country: "India" },
  { name: "Kathmandu", country: "Nepal" },
  { name: "Colombo", country: "Sri Lanka" },
  { name: "Malé", country: "Maldives" },
  { name: "Dhaka", country: "Bangladesh" },
  { name: "Karachi", country: "Pakistan" },
  { name: "Lahore", country: "Pakistan" },
  { name: "Islamabad", country: "Pakistan" },
  { name: "Ulaanbaatar", country: "Mongolia" },
  { name: "Almaty", country: "Kazakhstan" },
  { name: "Astana", country: "Kazakhstan" },
  { name: "Tashkent", country: "Uzbekistan" },
  { name: "Abu Dhabi", country: "United Arab Emirates" },
  { name: "Doha", country: "Qatar" },
  { name: "Muscat", country: "Oman" },
  { name: "Manama", country: "Bahrain" },
  { name: "Kuwait City", country: "Kuwait" },
  { name: "Riyadh", country: "Saudi Arabia" },
  { name: "Jeddah", country: "Saudi Arabia" },
  { name: "Amman", country: "Jordan" },
  { name: "Tel Aviv", country: "Israel" },
  { name: "Jerusalem", country: "Israel" },
  { name: "Beirut", country: "Lebanon" },
  { name: "Marrakech", country: "Morocco" },
  { name: "Casablanca", country: "Morocco" },
  { name: "Fes", country: "Morocco" },
  { name: "Cairo", country: "Egypt" },
  { name: "Luxor", country: "Egypt" },
  { name: "Hurghada", country: "Egypt" },
  { name: "Tunis", country: "Tunisia" },
  { name: "Cape Town", country: "South Africa" },
  { name: "Johannesburg", country: "South Africa" },
  { name: "Durban", country: "South Africa" },
  { name: "Nairobi", country: "Kenya" },
  { name: "Dar es Salaam", country: "Tanzania" },
  { name: "Addis Ababa", country: "Ethiopia" },
  { name: "Lagos", country: "Nigeria" },
  { name: "Accra", country: "Ghana" },
  { name: "Dakar", country: "Senegal" },
  { name: "Sydney", country: "Australia" },
  { name: "Melbourne", country: "Australia" },
  { name: "Brisbane", country: "Australia" },
  { name: "Perth", country: "Australia" },
  { name: "Auckland", country: "New Zealand" },
  { name: "Wellington", country: "New Zealand" },
  { name: "Queenstown", country: "New Zealand" },
  { name: "Vancouver", country: "Canada" },
  { name: "Montreal", country: "Canada" },
  { name: "Calgary", country: "Canada" },
  { name: "Ottawa", country: "Canada" },
  { name: "San Francisco", country: "United States" },
  { name: "Boston", country: "United States" },
  { name: "Seattle", country: "United States" },
  { name: "Miami", country: "United States" },
  { name: "Las Vegas", country: "United States" },
  { name: "Denver", country: "United States" },
  { name: "Austin", country: "United States" },
  { name: "New Orleans", country: "United States" },
  { name: "Philadelphia", country: "United States" },
  { name: "San Diego", country: "United States" },
  { name: "Honolulu", country: "United States" },
  { name: "Atlanta", country: "United States" },
  { name: "Dallas", country: "United States" },
  { name: "Houston", country: "United States" },
  { name: "Phoenix", country: "United States" },
  { name: "Portland", country: "United States" },
  { name: "Nashville", country: "United States" },
  { name: "Orlando", country: "United States" },
  { name: "Havana", country: "Cuba" },
  { name: "Cancun", country: "Mexico" },
  { name: "Guadalajara", country: "Mexico" },
  { name: "Bogota", country: "Colombia" },
  { name: "Cartagena", country: "Colombia" },
  { name: "Lima", country: "Peru" },
  { name: "Cusco", country: "Peru" },
  { name: "Santiago", country: "Chile" },
  { name: "Montevideo", country: "Uruguay" },
  { name: "Quito", country: "Ecuador" },
  { name: "La Paz", country: "Bolivia" },
  { name: "Brasilia", country: "Brazil" },
  { name: "Salvador", country: "Brazil" },
];

export const CITY_OPTIONS: CityOption[] = [
  ...CURATED.map(({ name, country }) => ({ name, country })),
  ...MULTI_AIRPORT_ONLY,
  ...COMMON_DESTINATIONS,
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
