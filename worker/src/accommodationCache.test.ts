// The accommodation cache - what one generation tells every later one.
//
// This had no test, and it is the highest-leverage write in the pipeline:
// what it stores is handed to the next ~20 hours of generations for that
// city as established fact, with the instruction "do not perform a new
// accommodation search". A wrong number here is not one bad trip, it is
// every trip to that city until the key expires, with the search that would
// have corrected it suppressed.
//
// Two defects were fixed here without a test to hold them shut:
//
//   - there was NO price check. A lodging item shipping at 0 was cached,
//     and every later generation was told the rate was "verified via live
//     search at approx EUR0/night". The trip's largest line, priced at
//     zero, from a cache that suppressed the search that would have found
//     the real figure. An omitted field read "approx EURundefined/night".
//
//   - the write REPLACED the existing entry rather than merging, so a
//     named property became an unnamed one - which the comment in the code
//     claimed to prevent and did not, because `item.venue_name ??
//     undefined` is undefined for an unnamed item, JSON.stringify drops the
//     key, and redis.set overwrites.
//
// A fake Redis, so no network and nothing to clean up.
//
// Run: npm run test:accommodation-cache

import { cacheLodgingFacts, loadCachedLodgingEntries, loadCachedLodgingFacts } from "./lodgingCache";
import { check, finish, heading, section } from "./testutil";
import type { Redis } from "ioredis";
import type { Itinerary, ItineraryItem, TripBriefInput } from "./types";

heading("accommodation cache");

/** Just the commands lodgingCache.ts uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    mget: async (...keys: string[]) => keys.flat().map((k) => store.get(String(k)) ?? null),
    set: async (k: string, v: string, ..._rest: unknown[]) => {
      store.set(k, v);
      return "OK";
    },
  } as unknown as Redis;
  return { redis, store };
}

const brief = (over: Partial<TripBriefInput> = {}): TripBriefInput => ({
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2026-04-11",
  end_date: "2026-04-13",
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 1500,
  pace: "moderate",
  interests: [],
  must_see: [],
  dietary_constraints: [],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: false,
  ...over,
});

const bed = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  time: "22:00",
  type: "lodging",
  title: "Check in at Hotel Monti Palace",
  venue_name: "Hotel Monti Palace",
  location: "Rome",
  cost_estimate_eur: 140,
  reasoning: "Central.",
  source_confidence: "grounded",
  confidence_tier: "verified",
  source_urls: ["https://example.com/hotel"],
  ...over,
});

const tripWith = (items: ItineraryItem[]): Itinerary => ({
  budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "ok" },
  trip_summary: "s",
  key_decisions: [],
  things_to_skip: [],
  days: [{ day: 1, date: "2026-04-11", items, feasibility_flag: null }],
});

async function main() {
  section("a real verified rate is cached");

  {
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed()]));
    check("something was written", store.size === 1, String(store.size));
    const entries = await loadCachedLodgingEntries(redis, ["Rome"]);
    const e = entries.get("Rome");
    check("the price round-trips", e?.costEstimateEur === 140, JSON.stringify(e));
    check("the property name is kept", e?.name === "Hotel Monti Palace", String(e?.name));
    const facts = await loadCachedLodgingFacts(redis, ["Rome"]);
    check("and it reads back as a usable fact string", typeof facts["Rome"] === "string" && facts["Rome"].includes("140"), JSON.stringify(facts));
  }

  section("a zero or missing price must NEVER be cached");

  // The defect: cached as fact, then handed to every generation for that
  // city with "do not perform a new accommodation search".
  for (const [label, price] of [
    ["zero", 0],
    ["negative", -50],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ] as const) {
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed({ cost_estimate_eur: price })]));
    check(`a ${label} price writes nothing`, store.size === 0, `store size ${store.size}`);
  }

  {
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(
      redis,
      brief(),
      tripWith([bed({ cost_estimate_eur: undefined as unknown as number })])
    );
    check("a missing price writes nothing", store.size === 0, `store size ${store.size}`);
  }

  section("only a rate we actually stood behind");

  for (const tier of ["inferred", undefined] as const) {
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed({ confidence_tier: tier })]));
    check(`an ${tier ?? "untiered"} rate is not cached as fact`, store.size === 0, `store size ${store.size}`);
  }

  {
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed({ confidence_tier: "single_source" })]));
    check("a single-source rate IS cached", store.size === 1, String(store.size));
  }

  section("a later write must not erase a named property");

  {
    // The exact shape of the bug: generation 1 confirmed the hotel by name,
    // generation 2 could not (checkVenues stripped venue_name) but still
    // had a price. A replacing write turned a named entry into an unnamed
    // one, which the code's own comment said was impossible.
    const { redis } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed()]));
    await cacheLodgingFacts(
      redis,
      brief(),
      tripWith([bed({ venue_name: null, cost_estimate_eur: 155 })])
    );
    const e = (await loadCachedLodgingEntries(redis, ["Rome"])).get("Rome");
    check("the newer price wins", e?.costEstimateEur === 155, JSON.stringify(e));
    check("and the known property name survives", e?.name === "Hotel Monti Palace", String(e?.name));
  }

  section("only the trip's own destinations");

  {
    // location has to match a destination in the brief, or the entry would
    // be filed under a city this trip was never about.
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed({ location: "Naples" })]));
    check("a bed in a city not in the brief is not cached", store.size === 0, `store size ${store.size}`);
  }

  {
    // "Monti, Rome" must still file under Rome.
    const { redis } = fakeRedis();
    await cacheLodgingFacts(redis, brief(), tripWith([bed({ location: "Monti, Rome" })]));
    const e = (await loadCachedLodgingEntries(redis, ["Rome"])).get("Rome");
    check("a neighbourhood-qualified location still files under the city", e?.costEstimateEur === 140, JSON.stringify(e));
  }

  section("one entry per city, and nothing else cached");

  {
    const { redis, store } = fakeRedis();
    await cacheLodgingFacts(
      redis,
      brief(),
      tripWith([bed(), bed({ title: "Another night", cost_estimate_eur: 999 })])
    );
    check("two beds in one city write one entry", store.size === 1, String(store.size));
    const e = (await loadCachedLodgingEntries(redis, ["Rome"])).get("Rome");
    check("and it is the first one, not the last", e?.costEstimateEur === 140, JSON.stringify(e));
  }

  {
    const { redis, store } = fakeRedis();
    const meal: ItineraryItem = { ...bed(), type: "meal", title: "Dinner", cost_estimate_eur: 70 };
    await cacheLodgingFacts(redis, brief(), tripWith([meal]));
    check("a non-lodging item is never cached as a rate", store.size === 0, `store size ${store.size}`);
  }

  section("a broken cache must not fail the generation");

  {
    // Caching is bookkeeping for a future trip. It must never be the reason
    // the trip in front of the traveller fails.
    const exploding = {
      get: async () => { throw new Error("redis down"); },
      mget: async () => { throw new Error("redis down"); },
      set: async () => { throw new Error("redis down"); },
    } as unknown as Redis;
    let threw = false;
    try {
      await cacheLodgingFacts(exploding, brief(), tripWith([bed()]));
    } catch {
      threw = true;
    }
    check("a Redis failure is swallowed, not thrown", threw === false);
  }

  {
    const { redis } = fakeRedis();
    let threw = false;
    try {
      await cacheLodgingFacts(redis, brief(), { ...tripWith([]), days: undefined as never });
    } catch {
      threw = true;
    }
    check("an itinerary with no days does not throw", threw === false);
  }

  finish();
}

main();
