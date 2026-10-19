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
//   BOOKING.COM BY COUNTRY. On CJ Booking.com is several programmes, each
//   paying only for travellers in its own countries (North America is the
//   US and Canada). NEXT_PUBLIC_CJ_BOOKING_AIDS names a link id per
//   country, e.g. "US:111,CA:111,EU:222,*:333" - ISO country codes, "EU"
//   for the 27 EU countries, "*" for everyone else. With it set, a hotel
//   link goes through /go/booking (app/go/booking/route.ts), which picks
//   the programme by the traveller's country when they click - so it is
//   right in an email opened abroad too. A country with no programme gets
//   the plain Booking.com search. The single NEXT_PUBLIC_CJ_BOOKING_AID
//   still works, for everyone, when the list is not set.
//
// Run: npm run test:booking-links

import type { ItineraryDay, ItineraryItem } from "./types";

export interface AffiliateIds {
  /** Both or neither: a CJ deep link needs the property and the ad. */
  cj?: { pid: string; bookingAid: string };
  /** A Booking.com link id per country (see the header), with the CJ
   * property id. Wins over `cj`: the link goes through /go/booking. */
  cjRegional?: { pid: string; aids: Record<string, string> };
  /** Both or neither: an Awin link needs the publisher and the advertiser. */
  awin?: { publisherId: string; bookingMid: string };
  gygPartnerId?: string;
}

export interface BookingLink {
  kind: "stay" | "tickets" | "transport";
  url: string;
  affiliate: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A stored itinerary is model output that outlives deploys: a field the
 * type calls a string can be a number, a list or missing (see
 * lib/renderTrip.test.tsx). Anything not a string reads as empty. */
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The 27 EU member states, for "EU" in NEXT_PUBLIC_CJ_BOOKING_AIDS. */
export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];

/** "US:111,CA:111,EU:222,*:333" -> { US: "111", CA: "111", AT: "222", ..., "*": "333" }.
 * Entries that do not look right are dropped, not guessed at. A country
 * named on its own beats the same country inside "EU", wherever it is
 * written. */
export function parseBookingAids(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const explicit: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [rawKey, rawAid] = part.split(":").map((x) => x?.trim() ?? "");
    const key = rawKey.toUpperCase();
    if (!/^\d{1,12}$/.test(rawAid)) continue;
    if (key === "EU") for (const c of EU_COUNTRIES) out[c] ??= rawAid;
    else if (key === "*" || /^[A-Z]{2}$/.test(key)) explicit[key] = rawAid;
  }
  return { ...out, ...explicit };
}

/** The Booking.com link id for a traveller in `country`, or null. */
export function bookingAidFor(aids: Record<string, string>, country: string | null | undefined): string | null {
  const code = (country ?? "").trim().toUpperCase();
  return (/^[A-Z]{2}$/.test(code) ? aids[code] : undefined) ?? aids["*"] ?? null;
}

/** The configured ids, each only if it looks like an id. Read at build
 * time (NEXT_PUBLIC_), which is when Next inlines them. */
export function affiliateIds(): AffiliateIds {
  const publisherId = process.env.NEXT_PUBLIC_AWIN_PUBLISHER_ID?.trim();
  const bookingMid = process.env.NEXT_PUBLIC_AWIN_BOOKING_MID?.trim();
  const cjPid = process.env.NEXT_PUBLIC_CJ_PID?.trim();
  const cjAid = process.env.NEXT_PUBLIC_CJ_BOOKING_AID?.trim();
  const gyg = process.env.NEXT_PUBLIC_GYG_PARTNER_ID?.trim();
  const aids = parseBookingAids(process.env.NEXT_PUBLIC_CJ_BOOKING_AIDS);
  return {
    ...(cjPid && /^\d{1,12}$/.test(cjPid) && Object.keys(aids).length > 0 ? { cjRegional: { pid: cjPid, aids } } : {}),
    ...(cjPid && cjAid && /^\d{1,12}$/.test(cjPid) && /^\d{1,12}$/.test(cjAid) ? { cj: { pid: cjPid, bookingAid: cjAid } } : {}),
    ...(publisherId && bookingMid && ID.test(publisherId) && ID.test(bookingMid)
      ? { awin: { publisherId, bookingMid } }
      : {}),
    ...(gyg && ID.test(gyg) ? { gygPartnerId: gyg } : {}),
  };
}

export function hasAffiliates(ids: AffiliateIds): boolean {
  return Boolean(ids.cjRegional || ids.cj || ids.awin || ids.gygPartnerId);
}

/** Where /go/booking sends a traveller: the CJ programme for their
 * country, else Awin, else the plain search. `target` must be a
 * Booking.com search - anything else is refused (null), so the route can
 * never be used to send someone to another site. */
export function bookingRedirectFor(target: string, country: string | null | undefined, ids: AffiliateIds): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.booking.com" || url.username || url.password || url.port) return null;
  const clean = url.toString();
  const aid = ids.cjRegional ? bookingAidFor(ids.cjRegional.aids, country) : null;
  if (ids.cjRegional && aid) return cjLink(ids.cjRegional.pid, aid, clean);
  if (ids.cj) return cjLink(ids.cj.pid, ids.cj.bookingAid, clean);
  if (ids.awin) return awinLink(ids.awin, clean);
  return clean;
}

/** CJ's deep link: the click is recorded against the ad, then the
 * traveller lands on exactly this search. */
function cjLink(pid: string, aid: string, url: string): string {
  return `https://www.anrdoezrs.net/click-${pid}-${aid}?url=${encodeURIComponent(url)}`;
}

/** Awin's deep link: their redirect records the click, then sends the
 * traveller on to exactly this search. */
function awinLink(awin: { publisherId: string; bookingMid: string }, url: string): string {
  return `https://www.awin1.com/cread.php?${new URLSearchParams({ awinmid: awin.bookingMid, awinaffid: awin.publisherId, ued: url })}`;
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
  ids: AffiliateIds,
  options: { site?: string } = {}
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
    if (ids.cjRegional) {
      // Through our own redirect, which knows the traveller's country.
      // Absolute when a site is given (an email), relative on the site.
      const go = `/go/booking?${new URLSearchParams({ u: url })}`;
      return { kind: "stay", url: `${(options.site ?? "").replace(/\/$/, "")}${go}`, affiliate: true };
    }
    if (ids.cj) return { kind: "stay", url: cjLink(ids.cj.pid, ids.cj.bookingAid, url), affiliate: true };
    if (ids.awin) return { kind: "stay", url: awinLink(ids.awin, url), affiliate: true };
    return { kind: "stay", url, affiliate: false };
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

/** Omio's route pages are named by city: "rome", "mexico-city". */
function routeSlug(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Trains and buses between two of the trip's cities: Omio's page for
 * that route, which compares every operator on it.
 *
 * Only when the line itself names both ends. The itinerary does not say
 * which city a day is in, and a train line that says "Train to the coast"
 * has no route a link could honestly point at. City names are matched as
 * the traveller entered them, in Latin script - a Bulgarian trip whose
 * cities were typed in Cyrillic gets no link rather than a wrong one.
 * No affiliate id yet: Omio pays through Travelpayouts, see the README. */
export function groundLinkFor(item: ItineraryItem, destinations: string[] | undefined): BookingLink | null {
  if (item.type !== "transport" || item.is_flight) return null;
  const text = `${str(item.title)} ${str(item.location)}`.toLowerCase();
  const hits: { city: string; at: number }[] = [];
  for (const city of destinations ?? []) {
    const name = str(city);
    if (!name || !/^[\p{Script=Latin}\s.'-]+$/u.test(name)) continue;
    const at = text.indexOf(name.toLowerCase());
    if (at >= 0) hits.push({ city: name, at });
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.at - b.at);
  // "to Florence from Rome": the word before each name says which end it
  // is, and beats the order the names happen to appear in.
  const before = (h: { at: number }) => text.slice(0, h.at).trim().split(/\s+/).pop() ?? "";
  const origin = hits.find((h) => before(h) === "from");
  const destination = hits.find((h) => before(h) === "to" && h !== origin);
  const first = origin ?? hits.find((h) => h !== destination)!;
  const second = destination && destination !== first ? destination : hits.find((h) => h !== first)!;
  const from = routeSlug(first.city);
  const to = routeSlug(second.city);
  if (!from || !to || from === to) return null;
  return { kind: "transport", url: `https://www.omio.com/travel/${from}/${to}`, affiliate: false };
}
