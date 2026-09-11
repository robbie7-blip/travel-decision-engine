// Tests the Places verification pass - the code that DELETES venues.
//
// It had no direct test. Three separate silent venue-deletion bugs have
// lived in this file (a normalizer that erased every Cyrillic name, a
// geocode that resolved "Trastevere, Rome, Italy" to Italy and then
// rejected every venue on distance, and a clock parser that read "7:30 PM"
// as half past seven in the morning), and each was found by reading the
// code or paying for a generation rather than by a failing test. The two
// suites that mention checkVenues only do so in comments; neither calls it.
//
// It is also the second caller of the shared runWithLimit, and the live
// rehearsal cannot reach it - that runs without a Places key, so
// checkVenues returns immediately.
//
// `globalThis.fetch` is stubbed, so no key, no network, no cost. Both
// endpoints this file touches go through it: Open-Meteo for the city
// geocode and Places Text Search for the venue.
//
// Run: npm run test:venues

import { checkVenues } from "./venueVerification";
import { check, finish, heading, section } from "../testutil";
import type { Itinerary, ItineraryItem } from "../types";

heading("Places verification");

const ROME = { latitude: 41.9028, longitude: 12.4964 };

/** One Places "place" in the shape the field mask asks for. */
function place(over: Record<string, unknown> = {}) {
  return {
    id: "places/abc",
    displayName: { text: "Armando al Pantheon" },
    formattedAddress: "Salita dei Crescenzi 31, Rome",
    location: ROME,
    rating: 4.5,
    userRatingCount: 3000,
    businessStatus: "OPERATIONAL",
    regularOpeningHours: {
      periods: [
        { open: { day: 1, hour: 12, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } },
        { open: { day: 2, hour: 12, minute: 0 }, close: { day: 2, hour: 23, minute: 0 } },
        { open: { day: 3, hour: 12, minute: 0 }, close: { day: 3, hour: 23, minute: 0 } },
        { open: { day: 4, hour: 12, minute: 0 }, close: { day: 4, hour: 23, minute: 0 } },
        { open: { day: 5, hour: 12, minute: 0 }, close: { day: 5, hour: 23, minute: 0 } },
        { open: { day: 6, hour: 12, minute: 0 }, close: { day: 6, hour: 23, minute: 0 } },
        { open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } },
      ],
      weekdayDescriptions: ["Monday: 12:00 – 11:00 PM"],
    },
    ...over,
  };
}

const meal = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  time: "20:00",
  type: "meal",
  title: "Dinner at Armando al Pantheon",
  venue_name: "Armando al Pantheon",
  location: "Rome",
  cost_estimate_eur: 70,
  reasoning: "Family-run.",
  source_confidence: "grounded",
  ...over,
});

const trip = (items: ItineraryItem[]): Itinerary => ({
  budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "ok" },
  trip_summary: "s",
  key_decisions: [],
  things_to_skip: [],
  // 2026-04-14 is a Tuesday, inside every period above.
  days: [{ day: 1, date: "2026-04-14", items, feasibility_flag: null }],
});

/** Installs a fetch stub. `onPlaces` decides what Text Search returns, and
 * receives the venue name that was actually queried - because a stub that
 * answers every query with the same business is not Places, it is a
 * name-mismatch generator: the first version of the fan-out test below
 * returned "Armando al Pantheon" for twelve differently-named venues, and
 * namesLikelyMatch correctly rejected all twelve. */
function stubFetch(onPlaces: (calls: number, queriedName: string) => { status?: number; body?: unknown }) {
  let placesCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    const href = String(url);
    if (init?.method === "POST" && href.includes("places.googleapis.com")) {
      placesCalls++;
      // "Venue 3, Rome" -> "Venue 3"
      let queriedName = "";
      try {
        queriedName = String(JSON.parse(init.body ?? "{}").textQuery ?? "").split(",")[0].trim();
      } catch {
        queriedName = "";
      }
      const { status = 200, body = {} } = onPlaces(placesCalls, queriedName);
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }
    // Open-Meteo geocode for the city.
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [ROME] }),
    } as Response;
  }) as typeof globalThis.fetch;
  return {
    restore: () => { globalThis.fetch = original; },
    get placesCalls() { return placesCalls; },
  };
}

async function main() {
  const hadKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "stub-key";

  section("a real, open, well-rated venue survives and is enriched");

  {
    const f = stubFetch(() => ({ body: { places: [place()] } }));
    const out = await checkVenues(trip([meal()]));
    f.restore();
    const item = out.days[0].items[0];
    check("the item is kept", out.days[0].items.length === 1);
    check("it keeps its venue name", item.venue_name === "Armando al Pantheon", String(item.venue_name));
    check("the rating is attached", item.google_rating === 4.5, String(item.google_rating));
    check("open-on-the-day is recorded", item.google_open_on_visit === true, String(item.google_open_on_visit));
    check("a Maps link is attached", typeof item.google_maps_url === "string" && item.google_maps_url.length > 0);
    check("coordinates are attached", item.google_lat === ROME.latitude, String(item.google_lat));
    check("a Places call was actually made", f.placesCalls === 1, String(f.placesCalls));
  }

  section("closed permanently - deleted");

  {
    const f = stubFetch(() => ({ body: { places: [place({ businessStatus: "CLOSED_PERMANENTLY" })] } }));
    const out = await checkVenues(trip([meal()]));
    f.restore();
    check("the item is removed", out.days[0].items.length === 0, JSON.stringify(out.days[0].items.map((i) => i.title)));
  }

  section("shut on the day we send them - deleted");

  {
    // Open only on Sunday; the item is on a Tuesday.
    const sundayOnly = place({
      regularOpeningHours: {
        periods: [{ open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } }],
        weekdayDescriptions: ["Sunday: 12:00 – 11:00 PM"],
      },
    });
    const f = stubFetch(() => ({ body: { places: [sundayOnly] } }));
    const out = await checkVenues(trip([meal()]));
    f.restore();
    check("a venue shut that day is removed", out.days[0].items.length === 0);
  }

  section("the verifier being down must NOT delete anything");

  {
    // This is the distinction the file exists to protect: "we could not
    // ask" is not "this restaurant does not exist". A 500 for every item
    // would otherwise empty the whole trip.
    const f = stubFetch(() => ({ status: 500, body: {} }));
    const out = await checkVenues(trip([meal(), meal({ title: "Lunch", venue_name: "Roscioli", time: "13:00" })]));
    f.restore();
    check("both items survive a Places outage", out.days[0].items.length === 2, String(out.days[0].items.length));
    check("and are not marked verified", out.days[0].items[0].google_rating === undefined);
  }

  section("no such business - the name is stripped, not the item");

  {
    const f = stubFetch(() => ({ body: { places: [] } }));
    const out = await checkVenues(trip([meal()]));
    f.restore();
    const item = out.days[0].items[0];
    // An unmatched meal is removed so a repair can put a real place in the
    // slot; what must never happen is it surviving WITH the unverified
    // name still attached and no evidence.
    const kept = out.days[0].items.length === 1;
    check(
      "an unmatched venue does not survive with its name intact",
      !kept || !item.venue_name,
      kept ? `kept with venue_name=${String(item.venue_name)}` : "removed"
    );
  }

  section("a wrong-business match is rejected on distance");

  {
    // Right name, 2,000 km away - a different Armando entirely.
    const faraway = place({ location: { latitude: 59.3293, longitude: 18.0686 } });
    const f = stubFetch(() => ({ body: { places: [faraway] } }));
    const out = await checkVenues(trip([meal()]));
    f.restore();
    const item = out.days[0].items[0];
    const kept = out.days[0].items.length === 1;
    check(
      "a match in the wrong city is not accepted as verification",
      !kept || (!item.google_maps_url && !item.google_rating),
      kept ? `kept with url=${String(item.google_maps_url)} rating=${String(item.google_rating)}` : "removed"
    );
  }

  section("an item with no venue to check is left alone");

  {
    const f = stubFetch(() => ({ body: { places: [place()] } }));
    const out = await checkVenues(trip([meal({ title: "Walk through Monti", venue_name: null, type: "activity" })]));
    f.restore();
    check("an unnamed activity survives untouched", out.days[0].items.length === 1);
    check("and costs no Places call", f.placesCalls === 0, String(f.placesCalls));
  }

  section("bounded fan-out - the shared runWithLimit's other caller");

  {
    // Twelve named venues through the same helper the day calls use. This
    // is the path the live rehearsal cannot reach, since that runs without
    // a Places key.
    const many = Array.from({ length: 12 }, (_, i) =>
      meal({ title: `Dinner ${i}`, venue_name: `Venue ${i}`, time: "20:00" })
    );
    // Echo the queried name, as Places would.
    const f = stubFetch((_n, queriedName) => ({
      body: { places: [place({ displayName: { text: queriedName } })] },
    }));
    const out = await checkVenues(trip(many));
    f.restore();
    check("every venue was looked up", f.placesCalls === 12, String(f.placesCalls));
    check("all twelve survive verification", out.days[0].items.length === 12, String(out.days[0].items.length));
  }

  if (hadKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = hadKey;

  finish();
}

main();
