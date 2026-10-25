// fillUnnamedMeals: a meal with no named place gets a real one from a
// direct Places search, or stays as it was. fetch is stubbed: no key, no
// network, no cost.
//
// Run: npm run test:meal-fill

import { fallbackMealQuery, fillUnnamedMeals } from "./venueVerification";
import { check, finish, heading, section } from "../testutil";
import type { Itinerary, ItineraryItem } from "../types";

heading("naming unnamed meals from Places");

const FH = { latitude: 47.65, longitude: 9.48 };
const allWeek = (open: number, close: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: open, minute: 0 }, close: { day, hour: close, minute: 0 } }));

function place(name: string, over: Record<string, unknown> = {}) {
  return {
    id: `places/${name}`,
    displayName: { text: name },
    location: FH,
    rating: 4.6,
    userRatingCount: 400,
    businessStatus: "OPERATIONAL",
    regularOpeningHours: { periods: allWeek(11, 23), weekdayDescriptions: ["Monday: 11:00 AM - 11:00 PM"] },
    ...over,
  };
}

function meal(title: string, time: string, over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { type: "meal", title, time, location: "Friedrichshafen city center, Friedrichshafen", ...over } as ItineraryItem;
}

function stub(places: unknown[]) {
  const queries: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    if (String(url).includes("geocoding-api")) {
      return new Response(JSON.stringify({ results: [FH] }), { status: 200 });
    }
    queries.push(JSON.parse(init?.body ?? "{}").textQuery);
    return new Response(JSON.stringify({ places }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { queries, restore: () => (globalThis.fetch = original) };
}

async function main() {
  const hadKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "stub-key";

  section("the search asks for what the meal needs");
  {
    check("dinner, vegetarian", fallbackMealQuery({ title: "Dinner", time: "20:30" }, ["Vegetarian"]) === "vegetarian restaurant");
    check("breakfast is a cafe", fallbackMealQuery({ title: "Breakfast", time: "08:30" }, []) === "breakfast cafe");
    check("a morning slot is breakfast too", fallbackMealQuery({ title: "Закуска", time: "09:00" }, []) === "breakfast cafe");
  }

  section("the first place that clears every bar takes the slot");
  {
    const s = stub([
      place("Already Used"),
      place("Low Rated", { rating: 3.9 }),
      place("Few Reviews", { userRatingCount: 3 }),
      place("Closed At Night", { regularOpeningHours: { periods: allWeek(8, 15) } }),
      place("Shut For Good", { businessStatus: "CLOSED_PERMANENTLY" }),
      place("Across The Lake", { location: { latitude: 47.5, longitude: 9.7 } }),
      place("Gasthaus Krone"),
    ]);
    const dinner = meal("Dinner", "20:30");
    const itinerary = {
      days: [{ day: 1, date: "2027-01-15", items: [meal("Lunch at Already Used", "12:30", { venue_name: "Already Used" }), dinner] }],
    } as unknown as Itinerary;
    const filled = await fillUnnamedMeals(itinerary, ["vegetarian"]);
    s.restore();
    check("one meal named", filled === 1, String(filled));
    check("it is the one that passes", dinner.venue_name === "Gasthaus Krone" && dinner.title === "Dinner: Gasthaus Krone", dinner.title);
    check("with a real Maps link and rating", !!dinner.google_maps_url && dinner.google_rating === 4.6);
    check("only the unnamed meal was searched", s.queries.length === 1 && s.queries[0].startsWith("vegetarian restaurant"), JSON.stringify(s.queries));
  }

  section("two meals never get the same place");
  {
    const s = stub([place("Only One"), place("Second Best")]);
    const lunch = meal("Lunch", "12:30");
    const dinner = meal("Dinner", "19:30");
    const itinerary = { days: [{ day: 1, date: "2027-01-15", items: [lunch, dinner] }] } as unknown as Itinerary;
    await fillUnnamedMeals(itinerary, []);
    s.restore();
    check("different places", !!lunch.venue_name && !!dinner.venue_name && lunch.venue_name !== dinner.venue_name);
  }

  section("nothing good enough: the line stays as it was");
  {
    const s = stub([place("Meh", { rating: 3.5 })]);
    const dinner = meal("Dinner", "20:30");
    const itinerary = { days: [{ day: 1, date: "2027-01-15", items: [dinner] }] } as unknown as Itinerary;
    const filled = await fillUnnamedMeals(itinerary, []);
    s.restore();
    check("unchanged", filled === 0 && dinner.title === "Dinner" && !dinner.venue_name);
  }

  section("Google failing never costs the trip");
  {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof globalThis.fetch;
    const dinner = meal("Dinner", "20:30");
    const itinerary = { days: [{ day: 1, date: "2027-01-15", items: [dinner] }] } as unknown as Itinerary;
    let threw = false;
    try {
      await fillUnnamedMeals(itinerary, []);
    } catch {
      threw = true;
    }
    globalThis.fetch = original;
    check("no throw, meal unchanged", !threw && dinner.title === "Dinner");
  }

  section("no key, no search");
  {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const s = stub([place("X")]);
    const itinerary = { days: [{ day: 1, date: "2027-01-15", items: [meal("Dinner", "20:30")] }] } as unknown as Itinerary;
    const filled = await fillUnnamedMeals(itinerary, []);
    s.restore();
    check("nothing called", filled === 0 && s.queries.length === 0);
  }

  if (hadKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = hadKey;
  finish();
}

main();
