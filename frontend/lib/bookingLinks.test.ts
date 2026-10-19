// Run: npm run test:booking-links

import assert from "node:assert/strict";
import { bookingAidFor, bookingLinkFor, bookingRedirectFor, groundLinkFor, hasAffiliates, parseBookingAids, stayDates } from "./bookingLinks";
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

// Booking.com by country: one CJ programme per region.
const aids = parseBookingAids(" us:111, CA:111 ,EU:222, DE:999, *:333, XX, FR:abc, nonsense ");
assert.equal(bookingAidFor(aids, "US"), "111");
assert.equal(bookingAidFor(aids, "ca"), "111", "country codes in any case");
assert.equal(bookingAidFor(aids, "BG"), "222", "EU covers Bulgaria");
assert.equal(bookingAidFor(aids, "DE"), "999", "a country named on its own beats EU");
assert.equal(bookingAidFor(aids, "FR"), "222", "a malformed entry is dropped, EU still covers France");
assert.equal(bookingAidFor(aids, "JP"), "333", "everyone else gets the default");
assert.equal(bookingAidFor(aids, null), "333", "no country known: the default");
assert.equal(bookingAidFor(parseBookingAids("US:111"), "BG"), null, "no default: nothing");
assert.deepEqual(parseBookingAids(undefined), {});

const regional = { cjRegional: { pid: "1234567", aids }, cj: { pid: "1234567", bookingAid: "7654321" } };
const viaGo = bookingLinkFor(days[0].items[0], stays.get("1:0"), regional)!;
assert.ok(viaGo.url.startsWith("/go/booking?"), "with countries set, a stay goes through our redirect");
assert.equal(new URLSearchParams(viaGo.url.split("?")[1]).get("u"), stay.url, "carrying the same search");
assert.ok(viaGo.affiliate);
const inEmail = bookingLinkFor(days[0].items[0], stays.get("1:0"), regional, { site: "https://yourdecide.com/" })!;
assert.ok(inEmail.url.startsWith("https://yourdecide.com/go/booking?"), "absolute in an email");
assert.ok(hasAffiliates({ cjRegional: { pid: "1", aids: { "*": "2" } } }));

// The redirect itself.
const us = new URL(bookingRedirectFor(stay.url, "US", regional)!);
assert.equal(us.pathname, "/click-1234567-111", "a US traveller gets the North America programme");
assert.equal(us.searchParams.get("url"), stay.url);
assert.equal(new URL(bookingRedirectFor(stay.url, "BG", regional)!).pathname, "/click-1234567-222");
const noDefault = { cjRegional: { pid: "1234567", aids: parseBookingAids("US:111") } };
assert.equal(bookingRedirectFor(stay.url, "BG", noDefault), stay.url, "a country with no programme gets the plain search");
assert.equal(new URL(bookingRedirectFor(stay.url, "BG", { ...noDefault, awin: { publisherId: "9", bookingMid: "8" } })!).hostname, "www.awin1.com", "or Awin, if set");
// Never anywhere but Booking.com.
for (const bad of ["https://evil.example/x", "http://www.booking.com/x", "https://www.booking.com.evil.example/", "https://user@www.booking.com/", "javascript:alert(1)", "", "/relative"]) {
  assert.equal(bookingRedirectFor(bad, "US", regional), null, `refused: ${bad}`);
}

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

// Trains and buses between two of the trip's cities.
const train = (title: string, location = "") =>
  ({ time: "09:00", type: "transport", title, location, cost_estimate_eur: 20, reasoning: "", source_confidence: "inferred" }) as never;
assert.equal(groundLinkFor(train("Train Brussels to Bruges"), ["Brussels", "Bruges"])?.url, "https://www.omio.com/travel/brussels/bruges");
assert.equal(groundLinkFor(train("Back by train", "Bruges to Brussels"), ["Brussels", "Bruges"])?.url, "https://www.omio.com/travel/bruges/brussels", "the order in the text is the direction");
assert.equal(groundLinkFor(train("Frecciarossa to Florence from Roma Termini", "Rome"), ["Rome", "Florence"])?.url, "https://www.omio.com/travel/rome/florence", "'from' and 'to' decide, not word order");
assert.equal(groundLinkFor(train("Bus to Mexico City from Puebla"), ["Puebla", "Mexico City"])?.url, "https://www.omio.com/travel/puebla/mexico-city");
assert.equal(groundLinkFor(train("Day trip: Bruges and back to Brussels"), ["Brussels", "Bruges"])?.url, "https://www.omio.com/travel/bruges/brussels", "only a 'to': that end goes last");
assert.equal(groundLinkFor(train("Train to Zürich", "from München"), ["München", "Zürich"])?.url, "https://www.omio.com/travel/munchen/zurich", "accents fold");
assert.equal(groundLinkFor(train("Metro to the hotel", "Rome"), ["Rome", "Florence"]), null, "one city is not a route");
assert.equal(groundLinkFor(train("Влак от Рим до Флоренция"), ["Рим", "Флоренция"]), null, "Cyrillic names: no link rather than a wrong one");
assert.equal(groundLinkFor({ ...(train("Flight Rome to Florence") as object), is_flight: true } as never, ["Rome", "Florence"]), null);
assert.equal(groundLinkFor(train("Train Rome to Florence"), undefined), null);

console.log("bookingLinks: all assertions passed");
