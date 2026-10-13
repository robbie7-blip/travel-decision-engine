// Which part of the trip is happening now.
//
// The trip page is a PLAN: seven days laid out at once, which is the right
// shape while deciding and the wrong one while standing in a street in
// Rome on day three. On the trip, the useful screen is today - what is
// next, what has already been, and nothing else competing for the top of
// the page.
//
// This is the decision, extracted so it can be tested without a clock: the
// caller passes the date and the time, and gets back which day it is and
// where in it. Everything here is pure.
//
// WHICH "TODAY", because there are two and they are not always the same.
// A traveller in Rome on a Rome trip has one answer. Somebody looking at
// their Tokyo itinerary from Sofia has two: the date on their phone and
// the date in Tokyo. This uses the DEVICE's date, deliberately - it is the
// date the person reading the screen is living in, it needs no timezone
// database, and it cannot be wrong about what the phone says. The cost is
// that opening a Tokyo itinerary from Europe late in the evening may show
// the previous day; that is the honest trade, and it is why nothing here
// claims to know the local time at the destination.
//
// Run: npm run test:today

import type { ItineraryDay, ItineraryItem } from "./types";

export interface TodayOnTrip {
  /** Today's day of the itinerary, or null when today is not a trip day -
   * before it starts, after it ends, or a gap in the dates. */
  day: ItineraryDay | null;
  /** 1-based position in the trip, for "day 3 of 7". 0 when day is null. */
  position: number;
  total: number;
  /** Items already in the past, earliest first. */
  past: ItineraryItem[];
  /** The next thing, and everything after it, in order. The first entry
   * is what the panel leads with. */
  upcoming: ItineraryItem[];
}

/** Minutes since midnight from an "HH:MM" time, or null if it is not one.
 *
 * Returns null rather than 0 for junk, because 0 is a real time (midnight)
 * and treating an unparseable time as midnight would file it as already
 * past for the whole day. */
export function minutesOfDay(time: string | undefined | null): number | null {
  if (typeof time !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Today's local date as YYYY-MM-DD.
 *
 * Built from the local parts rather than toISOString(), which converts to
 * UTC first - at 01:00 in Sofia that returns yesterday, which would have
 * shown the wrong day of the trip to anyone looking late at night or early
 * in the morning. */
export function localDateOf(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function todayOnTrip(
  days: ItineraryDay[] | undefined,
  today: string,
  minutesNow: number
): TodayOnTrip {
  const all = (days ?? []).filter((d): d is ItineraryDay => Boolean(d) && typeof d.date === "string");
  const empty: TodayOnTrip = { day: null, position: 0, total: all.length, past: [], upcoming: [] };

  const index = all.findIndex((d) => d.date === today);
  if (index === -1) return empty;

  const day = all[index];
  const items = (day.items ?? []).filter((item): item is ItineraryItem => Boolean(item));

  // An item with no usable time is never "past": it is something to do
  // today without a fixed hour, and burying it under "earlier" would hide
  // it for the whole day.
  const past: ItineraryItem[] = [];
  const upcoming: ItineraryItem[] = [];
  for (const item of items) {
    const at = minutesOfDay(item.time);
    if (at !== null && at < minutesNow) past.push(item);
    else upcoming.push(item);
  }

  return { day, position: index + 1, total: all.length, past, upcoming };
}
