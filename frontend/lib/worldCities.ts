// Every city and town in the world with at least 1,000 people, for the
// destination and origin fields. The short list in lib/cityOptions.ts is
// still shown first, instantly; this is what answers everything else, so
// "Friedrichshafen" is a suggestion rather than "Not on the list".
//
// Searched on the server (app/api/cities): the list is 2.6 MB, far too
// much to send to every visitor's phone for a field most of them fill in
// with one of the first suggestions anyway.
//
// Source: GeoNames (CC BY 4.0, credited on /privacy). Built by
// scripts/buildWorldCities.mjs; see there for the row format.
//
// Run: npm run test:world-cities

import { readFileSync } from "node:fs";
import path from "node:path";

/** [name, country code, population] or [..., GeoNames name] when the
 * English name differs from it. */
export type WorldCityRow = [string, string, number] | [string, string, number, string];

export interface WorldCityMatch {
  /** What to show. */
  name: string;
  /** The country, in the reader's language. */
  country: string;
  /** What goes into the trip brief. The bare name, unless a bigger place
   * somewhere else has the same name: picking Paris, Texas must not plan a
   * trip to France, so that one is written "Paris, United States". */
  value: string;
}

/** Same folding as lib/cityOptions.ts: case and accents ignored, so
 * "zurich" finds Zürich and "krakow" finds Kraków. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Bulgarian Cyrillic to Latin, the official streamlined system, so a
// Bulgarian reader typing "Мюнхен" or "Тбилиси" still gets somewhere: the
// list itself is in Latin script. Names spelled the same way in both work
// exactly ("Тбилиси" is "Tbilisi"); the rest fall back to the short list's
// own Bulgarian names and to typing in Latin.
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ь: "y", ю: "yu", я: "ya",
};

export function latinise(value: string): string {
  return [...value.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join("");
}

interface Indexed {
  row: WorldCityRow;
  /** Folded names to match against: the name, and the GeoNames one. */
  keys: string[];
}

export function indexCities(rows: WorldCityRow[]): Indexed[] {
  return rows.map((row) => ({ row, keys: row[3] ? [fold(row[0]), fold(row[3])] : [fold(row[0])] }));
}

/** The best matches for what has been typed, largest place first within
 * each kind of match: names that start with it, then names with a word
 * that starts with it ("san seb" finds San Sebastián). Fewer than two
 * letters returns nothing; a one-letter search would just be a list of the
 * world's biggest cities. */
export function searchCities(index: Indexed[], query: string, language: "en" | "bg", limit = 8): WorldCityMatch[] {
  const q = fold(latinise(query));
  if (q.length < 2) return [];
  const starts: Indexed[] = [];
  const words: Indexed[] = [];
  for (const entry of index) {
    if (entry.keys.some((k) => k.startsWith(q))) starts.push(entry);
    else if (q.length >= 3 && entry.keys.some((k) => k.includes(` ${q}`) || k.includes(`-${q}`))) words.push(entry);
    // The index is largest first, so once the first kind is full nothing
    // later can beat it.
    if (starts.length >= limit) break;
  }
  const picked = [...starts, ...words].slice(0, limit);

  const countryIn = regionNames(language);
  const countryEn = regionNames("en");
  return picked.map(({ row }) => {
    const [name, code] = row;
    const biggest = largestNamed(index, name);
    return {
      name,
      country: countryIn(code),
      value: biggest === row ? name : `${name}, ${countryEn(code)}`,
    };
  });
}

/** The largest place with exactly this name, which is the one the bare
 * name means. The list is sorted largest first, so it is the first. */
function largestNamed(index: Indexed[], name: string): WorldCityRow | undefined {
  return index.find((entry) => entry.row[0] === name)?.row;
}

function regionNames(language: "en" | "bg"): (code: string) => string {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([language], { type: "region" });
  } catch {
    names = null;
  }
  return (code) => {
    try {
      return names?.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

let loaded: Indexed[] | null = null;

/** The list, read once per server process. */
export function worldCities(): Indexed[] {
  loaded ??= indexCities(JSON.parse(readFileSync(path.join(process.cwd(), "data", "worldCities.json"), "utf8")) as WorldCityRow[]);
  return loaded;
}
