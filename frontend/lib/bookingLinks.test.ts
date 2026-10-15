// Run: npm run test:booking-links

import assert from "node:assert/strict";
import { bookingLinkFor, hasAffiliates, stayDates } from "./bookingLinks";
import type { ItineraryDay } from "./types";

const item = (type: string, extra: Record<string, unknown> = {}) =>
  ({ time: "15:00", type, title: "Check in", location: "Trastevere, Rome", cost_estimate_eur: 120, reasoning: "", source_confidence: "inferred", ...extra }) as never;

const days: ItineraryDay[] = [
  { day: 1, date: "2026-11-06", items: [item("lodging", { venue_name: "Hotel Raphael" })] },
  { day: 2, date: "2026-11-07", items: [item("lodging", { venue_name: "Hotel Raphael" })] },
  { day: 3, date: "2026-11-08", items: [item("lodging", { venue_name: "Palazzo Manfredi" })] },
  { day: 4, date: "2026-11-09", items: [item("activity", { venue_name: "Colosseum", cost_estimate_eur: 18 })] },
] as never;

const stays = stayDates(days, "2026-11-10");
assert.deepEqual(stays.get("1:0"), { checkIn: "2026-11-06", checkOut: "2026-11-08" }, "two nights at the same hotel are one stay");
assert.deepEqual(stays.get("2:0"), { checkIn: "2026-11-06", checkOut: "2026-11-08" });
assert.deepEqual(stays.get("3:0"), { checkIn: "2026-11-08", checkOut: "2026-11-10" }, "the last stay ends with the trip");

const none = {};
const stay = bookingLinkFor(days[0].items[0], stays.get("1:0"), none)!;
assert.equal(stay.kind, "stay");
assert.equal(stay.affiliate, false);
const u = new URL(stay.url);
assert.equal(u.hostname, "www.booking.com");
assert.equal(u.searchParams.get("ss"), "Hotel Raphael, Trastevere, Rome");
assert.equal(u.searchParams.get("checkin"), "2026-11-06");
assert.equal(u.searchParams.get("checkout"), "2026-11-08");

// Through Awin: their redirect, carrying the exact same search.
const paid = bookingLinkFor(days[0].items[0], stays.get("1:0"), { awin: { publisherId: "111", bookingMid: "6776" } })!;
const a = new URL(paid.url);
assert.equal(a.hostname, "www.awin1.com");
assert.equal(a.searchParams.get("awinmid"), "6776");
assert.equal(a.searchParams.get("awinaffid"), "111");
assert.equal(a.searchParams.get("ued"), stay.url, "the traveller lands on the same search");
assert.ok(paid.affiliate);

// Through CJ (Booking.com's network for Europe), which wins over Awin.
const viaCj = bookingLinkFor(days[0].items[0], stays.get("1:0"), {
  cj: { pid: "1234567", bookingAid: "7654321" },
  awin: { publisherId: "111", bookingMid: "6776" },
})!;
const c = new URL(viaCj.url);
assert.equal(c.hostname, "www.anrdoezrs.net");
assert.equal(c.pathname, "/click-1234567-7654321");
assert.equal(c.searchParams.get("url"), stay.url, "the traveller lands on the same search");
assert.ok(viaCj.affiliate);

const tickets = bookingLinkFor(days[3].items[0], undefined, { gygPartnerId: "ABC" })!;
assert.equal(tickets.kind, "tickets");
assert.equal(new URL(tickets.url).searchParams.get("q"), "Colosseum Trastevere, Rome");
assert.equal(new URL(tickets.url).searchParams.get("partner_id"), "ABC");

// Nothing to book: a free activity, an unnamed one, a meal, a flight.
assert.equal(bookingLinkFor(item("activity", { venue_name: "Pincio", cost_estimate_eur: 0 }), undefined, none), null);
assert.equal(bookingLinkFor(item("activity", { venue_name: null }), undefined, none), null);
assert.equal(bookingLinkFor(item("meal", { venue_name: "Roscioli" }), undefined, none), null);
assert.equal(bookingLinkFor(item("lodging", { is_flight: true }), undefined, none), null);
assert.equal(bookingLinkFor(item("lodging", { venue_name: null, title: "Check-out, Graça" }), undefined, none), null, "a stay needs a hotel name");

// No dates when they cannot be trusted.
const noDates = bookingLinkFor(days[0].items[0], { checkIn: "2026-11-06" }, none)!;
assert.equal(new URL(noDates.url).searchParams.get("checkin"), null);

assert.equal(hasAffiliates({}), false);
assert.equal(hasAffiliates({ gygPartnerId: "x" }), true);

console.log("bookingLinks: all assertions passed");
