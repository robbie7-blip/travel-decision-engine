// Redis-backed side of the visited-countries tracker - used only for the
// optional signed-in sync path (see app/api/visited); the primary,
// no-account-required path stores the same data client-side (see
// lib/localVisited.ts). Same "no new database" approach as account.ts.
//
// Stored as a Redis HASH `visited:<email>`, one field per country code,
// value a JSON blob of that country's metadata (visit date, pins) - richer
// than the original plain SET of codes, needed once a visit could carry an
// optional date and named pins (the Visualize views: Timeline, Chronology,
// Map Pins). This app has no real users yet (added the same day as this
// change), so there's no legacy-format migration to carry here - unlike
// lib/localVisited.ts, which does need one for whatever's already sitting
// in someone's browser.
//
// computeVisitedStats/groupCountriesByContinent below are pure functions
// with no Redis dependency, working off a plain code list - imported
// directly by the client-side page too, so the exact same stats math runs
// whether the codes came from local storage or from here.

import type { Redis } from "@upstash/redis";
import { COUNTRIES, CONTINENTS, TOTAL_COUNTRIES, getCountry, type Continent } from "./countries";

export interface VisitedPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  note?: string;
}

export interface VisitedEntry {
  code: string;
  visitedAt?: string; // ISO date, e.g. "2024-07-03" - optional, a visit doesn't need one
  pins?: VisitedPin[];
}

interface StoredMeta {
  visitedAt?: string;
  pins?: VisitedPin[];
}

function visitedKey(email: string): string {
  return `visited:${email.toLowerCase().trim()}`;
}

function parseMeta(raw: unknown): StoredMeta {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as StoredMeta;
    return {
      visitedAt: typeof parsed.visitedAt === "string" ? parsed.visitedAt : undefined,
      pins: Array.isArray(parsed.pins) ? parsed.pins : undefined,
    };
  } catch {
    return {};
  }
}

export async function getVisitedEntries(redis: Redis, email: string): Promise<VisitedEntry[]> {
  const raw = (await redis.hgetall<Record<string, string>>(visitedKey(email))) ?? {};
  // Silently drop any stored code that's no longer in COUNTRIES (e.g. a
  // future edit to countries.ts renames/removes one) rather than letting a
  // stale code skew stats or crash getCountry() lookups downstream.
  return Object.entries(raw)
    .filter(([code]) => getCountry(code) !== undefined)
    .map(([code, value]) => ({ code, ...parseMeta(value) }));
}

/** Convenience wrapper for the (more common) callers that only need the
 * code list, not full entries - e.g. /api/generate's soft-personalization
 * lookup, which only cares which countries, never when or which pins. */
export async function getVisitedCodes(redis: Redis, email: string): Promise<string[]> {
  return (await getVisitedEntries(redis, email)).map((e) => e.code);
}

export async function setVisitedEntry(
  redis: Redis,
  email: string,
  code: string,
  visited: boolean,
  meta?: { visitedAt?: string; pins?: VisitedPin[] }
): Promise<void> {
  const upper = code.toUpperCase();
  if (!getCountry(upper)) return; // silently ignore an unknown code rather than polluting the hash
  const key = visitedKey(email);
  if (visited) {
    const stored: StoredMeta = { visitedAt: meta?.visitedAt, pins: meta?.pins };
    await redis.hset(key, { [upper]: JSON.stringify(stored) });
  } else {
    await redis.hdel(key, upper);
  }
}

export interface Badge {
  id: string;
  // Threshold is checked against the specific stat named by `metric` - kept
  // as data (this array) rather than a chain of if-statements so adding a
  // badge later is a one-line addition, not new branching logic.
  metric: "countries" | "continents" | "percent";
  threshold: number;
}

// Deliberately few, deliberately round numbers for v1 - easy to extend
// once there's a sense of which milestones actually feel good to hit.
export const BADGES: Badge[] = [
  { id: "first_stamp", metric: "countries", threshold: 1 },
  { id: "explorer", metric: "countries", threshold: 10 },
  { id: "globetrotter", metric: "countries", threshold: 25 },
  { id: "continent_hopper", metric: "continents", threshold: 3 },
  { id: "all_continents", metric: "continents", threshold: 6 },
  { id: "half_the_world", metric: "percent", threshold: 50 },
];

export interface VisitedStats {
  countriesVisited: number;
  totalCountries: number;
  percentOfWorld: number; // 0-100, one decimal
  continentsVisited: Continent[];
  continentsTotal: number;
  earnedBadgeIds: string[];
}

/** Reduces a caller-supplied list to real, deduplicated country codes.
 *
 * Written for the anonymous share POST, which took `codes` straight from
 * an unauthenticated request body with only `typeof c === "string"` between
 * it and `JSON.stringify` into a Redis key that lives for 400 days. There
 * was no cap on how many entries, and none on how long each one was, so a
 * single request could store a value as large as the request body allowed -
 * and a caller choosing a new token each time could do it repeatedly.
 *
 * Validating rather than capping, because the honest bound is already in
 * the data: computeVisitedStats below discards every code getCountry does
 * not recognise, so anything else was never going to count for anything.
 * Filtering on the way IN costs nothing in behaviour and makes the stored
 * value at most TOTAL_COUNTRIES two-letter strings, whatever arrives.
 *
 * Deduplicated for the same reason - ["FR","FR",...] a thousand times over
 * counted once in the stats and stored a thousand times. */
export function sanitizeVisitedCodes(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  const seen = new Set<string>();
  for (const raw of codes) {
    if (typeof raw !== "string") continue;
    const code = raw.trim().toUpperCase();
    if (getCountry(code) === undefined) continue;
    seen.add(code);
  }
  return [...seen];
}

export function computeVisitedStats(codes: string[]): VisitedStats {
  // DEDUPLICATED, by canonical code. This was `codes.filter(...)` and then
  // `validCodes.length`, which counts ENTRIES rather than countries - so
  // ["FR","fr"] read as two countries visited, and one country repeated 195
  // times read as 195 countries and 99% of the world, badges included.
  //
  // Reachable through exactly one path, and it is a public one: the
  // anonymous share snapshot is whatever an unauthenticated caller POSTed
  // to app/api/visited/share, and app/api/stats-share/[token] hands it
  // straight to this function for anyone with the link to read as fact. The
  // signed-in path was never affected - it reads a Redis hash, whose keys
  // are unique by construction - and neither was the local page, which
  // passes Object.keys().
  //
  // Fixed HERE rather than only at the write, because snapshots stored
  // before the write-side check exists are still being read, and because
  // the function was internally inconsistent: `continents` was already a
  // Set and therefore right, while the count beside it was not.
  const visited = new Set<string>();
  const continents = new Set<Continent>();
  for (const code of codes) {
    const country = getCountry(code);
    if (!country) continue;
    visited.add(country.code);
    continents.add(country.continent);
  }
  const validCodes = [...visited];

  const countriesVisited = validCodes.length;
  const percentOfWorld = Math.round((countriesVisited / TOTAL_COUNTRIES) * 1000) / 10;
  const continentsVisited = CONTINENTS.filter((c) => continents.has(c));

  const earnedBadgeIds = BADGES.filter((b) => {
    const value =
      b.metric === "countries" ? countriesVisited : b.metric === "continents" ? continentsVisited.length : percentOfWorld;
    return value >= b.threshold;
  }).map((b) => b.id);

  return {
    countriesVisited,
    totalCountries: TOTAL_COUNTRIES,
    percentOfWorld,
    continentsVisited,
    continentsTotal: CONTINENTS.length,
    earnedBadgeIds,
  };
}

/** Grouped view for the tracker UI's continent-by-continent checklist -
 * every country in COUNTRIES, annotated with whether it's in this user's
 * visited set, still ordered/grouped by continent. */
export function groupCountriesByContinent(visitedCodes: Set<string>) {
  return CONTINENTS.map((continent) => ({
    continent,
    countries: COUNTRIES.filter((c) => c.continent === continent).map((c) => ({
      ...c,
      visited: visitedCodes.has(c.code),
    })),
  }));
}
