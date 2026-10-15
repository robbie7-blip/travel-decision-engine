// "Book this" links: a stay opens a Booking.com search for that hotel on
// those nights, a paid activity opens a GetYourGuide search for its
// tickets.
//
// Searches, not deep links to a listing: the plan names a place, not a
// Booking.com property id, and a search for the right name on the right
// dates lands on it - where a guessed listing URL would sometimes land on
// the wrong hotel.
//
// AFFILIATE IDS are optional and come from the environment. Without them
// the links still work, they just earn nothing; with them the page also
// shows a one-line disclosure, which the affiliate programmes and consumer
// law both expect.
//
//   Booking.com closed its direct affiliate programme in 2025 and now runs
//   it through networks by region: CJ for Europe, Awin elsewhere. So a
//   hotel link is wrapped in that network's tracking link:
//     CJ:   NEXT_PUBLIC_CJ_PID (the decide property's id in CJ) and
//           NEXT_PUBLIC_CJ_BOOKING_AID (the id of a Booking.com link in
//           CJ's "Get Links" that allows deep linking).
//     Awin: NEXT_PUBLIC_AWIN_PUBLISHER_ID and NEXT_PUBLIC_AWIN_BOOKING_MID.
//   CJ wins if both are set. GetYourGuide still runs its own programme:
//   NEXT_PUBLIC_GYG_PARTNER_ID.
//
// Run: npm run test:booking-links

import type { ItineraryDay, ItineraryItem } from "./types";

export interface AffiliateIds {
  /** Both or neither: a CJ deep link needs the property and the ad. */
  cj?: { pid: string; bookingAid: string };
  /** Both or neither: an Awin link needs the publisher and the advertiser. */
  awin?: { publisherId: string; bookingMid: string };
  gygPartnerId?: string;
}

export interface BookingLink {
  kind: "stay" | "tickets";
  url: string;
  affiliate: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A stored itinerary is model output that outlives deploys: a field the
 * type calls a string can be a number, a list or missing (see
 * lib/renderTrip.test.tsx). Anything not a string reads as empty. */
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The configured ids, each only if it looks like an id. Read at build
 * time (NEXT_PUBLIC_), which is when Next inlines them. */
export function affiliateIds(): AffiliateIds {
  const publisherId = process.env.NEXT_PUBLIC_AWIN_PUBLISHER_ID?.trim();
  const bookingMid = process.env.NEXT_PUBLIC_AWIN_BOOKING_MID?.trim();
  const cjPid = process.env.NEXT_PUBLIC_CJ_PID?.trim();
  const cjAid = process.env.NEXT_PUBLIC_CJ_BOOKING_AID?.trim();
  const gyg = process.env.NEXT_PUBLIC_GYG_PARTNER_ID?.trim();
  return {
    ...(cjPid && cjAid && /^\d{1,12}$/.test(cjPid) && /^\d{1,12}$/.test(cjAid) ? { cj: { pid: cjPid, bookingAid: cjAid } } : {}),
    ...(publisherId && bookingMid && ID.test(publisherId) && ID.test(bookingMid)
      ? { awin: { publisherId, bookingMid } }
      : {}),
    ...(gyg && ID.test(gyg) ? { gygPartnerId: gyg } : {}),
  };
}

export function hasAffiliates(ids: AffiliateIds): boolean {
  return Boolean(ids.cj || ids.awin || ids.gygPartnerId);
}

/** Check-in and check-out for each stay, keyed "day:index". A hotel that
 * repeats on consecutive days is one stay, checked out of when the next
 * different stay begins, or at the end of the trip. */
export function stayDates(days: ItineraryDay[], endDate: string | undefined): Map<string, { checkIn: string; checkOut?: string }> {
  const stays: { key: string; name: string; date: string }[] = [];
  for (const day of days) {
    (day.items ?? []).forEach((item, index) => {
      if (item.type === "lodging" && !item.is_flight && ISO.test(str(day.date))) {
        // Unnamed lines (a generic check-out) are skipped: they get no
        // link, and should not end the stay before them.
        const name = str(item.venue_name).toLowerCase();
        if (name) stays.push({ key: `${day.day}:${index}`, name, date: day.date });
      }
    });
  }
  const out = new Map<string, { checkIn: string; checkOut?: string }>();
  for (let i = 0; i < stays.length; i++) {
    // The first night of a run of the same hotel is the check-in.
    let start = i;
    while (start > 0 && stays[start - 1].name === stays[i].name) start--;
    let next = i + 1;
    while (next < stays.length && stays[next].name === stays[i].name) next++;
    const checkOut = next < stays.length ? stays[next].date : endDate && ISO.test(endDate) ? endDate : undefined;
    const checkIn = stays[start].date;
    out.set(stays[i].key, { checkIn, ...(checkOut && checkOut > checkIn ? { checkOut } : {}) });
  }
  return out;
}

export function bookingLinkFor(
  item: ItineraryItem,
  stay: { checkIn: string; checkOut?: string } | undefined,
  ids: AffiliateIds
): BookingLink | null {
  const place = str(item.venue_name);
  const where = str(item.location);

  // A stay only when the line names the hotel. A generic "Check-out" or
  // "Guesthouse in Graça" searched on Booking.com finds a page of
  // unrelated results, which is worse than no link.
  if (item.type === "lodging" && !item.is_flight) {
    if (!place) return null;
    const params = new URLSearchParams({ ss: where ? `${place}, ${where}` : place });
    if (stay?.checkIn && stay.checkOut) {
      params.set("checkin", stay.checkIn);
      params.set("checkout", stay.checkOut);
    }
    const url = `https://www.booking.com/searchresults.html?${params}`;
    if (ids.cj) {
      // CJ's deep link: the click is recorded against the ad, then the
      // traveller lands on exactly this search.
      return {
        kind: "stay",
        url: `https://www.anrdoezrs.net/click-${ids.cj.pid}-${ids.cj.bookingAid}?url=${encodeURIComponent(url)}`,
        affiliate: true,
      };
    }
    if (!ids.awin) return { kind: "stay", url, affiliate: false };
    // Awin's deep link: their redirect records the click, then sends the
    // traveller on to exactly this search.
    const awin = new URLSearchParams({ awinmid: ids.awin.bookingMid, awinaffid: ids.awin.publisherId, ued: url });
    return { kind: "stay", url: `https://www.awin1.com/cread.php?${awin}`, affiliate: true };
  }

  // Tickets only for a named place that costs something: a free park or a
  // walk has nothing to book, and a search for "Evening stroll" finds
  // nothing worth finding.
  if (item.type === "activity" && place && typeof item.cost_estimate_eur === "number" && item.cost_estimate_eur > 0) {
    const params = new URLSearchParams({ q: where ? `${place} ${where}` : place });
    if (ids.gygPartnerId) params.set("partner_id", ids.gygPartnerId);
    return { kind: "tickets", url: `https://www.getyourguide.com/s/?${params}`, affiliate: Boolean(ids.gygPartnerId) };
  }
  return null;
}
