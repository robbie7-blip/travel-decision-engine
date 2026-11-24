// The places a traveller chose dates for (TripBriefInput.city_dates, set
// on the homepage and checked in frontend/lib/cityDates.ts), applied to
// the plan: a day is planned in the place the traveller is on that date,
// whatever the model wrote.
//
// Run: npm run test:city-dates

import type { CityStay } from "../types";

/** Where the traveller is on a day: the place whose stay starts that day,
 * else the one it falls in. On a travel day that is the place they arrive
 * in, which is where the afternoon and the night are. Same rule as the
 * frontend's cityOnDate. */
export function cityOnDate(stays: CityStay[] | undefined, date: unknown): string | null {
  if (!stays || stays.length < 2 || typeof date !== "string") return null;
  for (let i = stays.length - 1; i >= 0; i--) {
    if (stays[i].start_date <= date && date <= stays[i].end_date) return stays[i].city;
  }
  return null;
}
