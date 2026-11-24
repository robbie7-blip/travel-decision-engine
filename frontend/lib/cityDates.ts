// Which dates the traveller is in which place, on a trip to more than one.
//
// Set on the homepage as nights per place, in the order the places were
// added ("3 nights in Rome, then 2 in Florence"); the dates follow from
// that, so they always cover the trip with no gap and no overlap. A day
// on which one stay ends and the next begins is the travel day between
// them: the traveller wakes up in the first place and sleeps in the next.
//
// The planner (worker/src/engine/cityDates.ts) holds every day of the plan
// to these dates.
//
// Run: npm run test:city-dates

import type { CityStay } from "./types";

export type { CityStay };

const DAY_MS = 86_400_000;

function toTime(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
}

function toIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Nights between two dates, or null. */
export function nightsBetween(start: string, end: string): number | null {
  const a = toTime(start);
  const b = toTime(end);
  return a === null || b === null || b < a ? null : Math.round((b - a) / DAY_MS);
}

/** An even split, the extra nights going to the first places. Every place
 * gets at least one night; null when there are fewer nights than places. */
export function evenNights(places: number, totalNights: number): number[] | null {
  if (places < 2 || totalNights < places) return null;
  const base = Math.floor(totalNights / places);
  const extra = totalNights % places;
  return Array.from({ length: places }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The nights asked for, made to fit: each place at least one night, the
 * total exactly the trip's. A change to one place is taken from (or given
 * to) the last place, which is what the form shows as "the rest". */
export function fitNights(nights: number[], places: number, totalNights: number): number[] | null {
  const fallback = evenNights(places, totalNights);
  if (!fallback) return null;
  if (nights.length !== places || nights.some((n) => !Number.isInteger(n) || n < 1)) return fallback;
  const fixed = nights.slice(0, -1);
  const rest = totalNights - fixed.reduce((a, b) => a + b, 0);
  return rest >= 1 ? [...fixed, rest] : fallback;
}

/** The stays, from the trip's first day and the nights in each place. */
export function staysFromNights(cities: string[], startDate: string, nights: number[]): CityStay[] {
  const start = toTime(startDate);
  if (start === null || cities.length !== nights.length) return [];
  let at = start;
  return cities.map((city, i) => {
    const stay = { city, start_date: toIso(at), end_date: toIso(at + nights[i] * DAY_MS) };
    at += nights[i] * DAY_MS;
    return stay;
  });
}

/** Checks stays sent with a trip: one per destination, spelled as the
 * destination is, in the order given, from the trip's first day to its
 * last with each starting the day the one before ends. Returns them with
 * the destinations' own spelling, or an error message. */
export function checkCityStays(
  raw: unknown,
  destinations: string[],
  startDate: string,
  endDate: string
): { ok: true; stays: CityStay[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length !== destinations.length || destinations.length < 2) {
    return { ok: false, error: "city_dates must give dates for each destination." };
  }
  const stays: CityStay[] = [];
  let expectedStart = startDate;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    const city = typeof r?.city === "string" ? r.city.trim() : "";
    const s = typeof r?.start_date === "string" ? r.start_date.trim() : "";
    const e = typeof r?.end_date === "string" ? r.end_date.trim() : "";
    if (city.toLowerCase() !== destinations[i].toLowerCase()) {
      return { ok: false, error: `city_dates must follow the destinations in order (expected ${destinations[i]}).` };
    }
    const nights = nightsBetween(s, e);
    if (s !== expectedStart || nights === null || nights < 1) {
      return { ok: false, error: `city_dates for ${destinations[i]} must start ${expectedStart} and last at least one night.` };
    }
    stays.push({ city: destinations[i], start_date: s, end_date: e });
    expectedStart = e;
  }
  if (expectedStart !== endDate) return { ok: false, error: "city_dates must end on the trip's last day." };
  return { ok: true, stays };
}

/** Where the traveller is on a day: the place whose stay starts that day,
 * else the one it falls in. On a travel day that is the place they arrive
 * in, which is where the day's afternoon and night are. */
export function cityOnDate(stays: CityStay[], date: string): string | null {
  for (let i = stays.length - 1; i >= 0; i--) {
    if (stays[i].start_date <= date && date <= stays[i].end_date) return stays[i].city;
  }
  return null;
}
