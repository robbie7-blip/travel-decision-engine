// The live flight fare - the second-largest line in most itineraries, and
// the one place this pipeline replaces the model's own number with a real
// quoted price.
//
// It had no test at all, and it was charging the return leg twice.
//
// Amadeus quotes a ROUND-TRIP fare. applyFlightPricing wrote that whole
// figure onto the arrival item on day 1 and stopped, while prompt.ts asks
// the model for "a real first-day arrival transport item AND a last-day
// departure transport item (e.g. train/flight, with a hedged cost
// estimate)" - so the departure item's own estimate sat underneath it,
// untouched. The traveler was billed a round trip plus one extra leg. The
// docstring above the function claimed the departure leg "keeps its
// existing free, already covered treatment"; no such treatment existed
// anywhere in the codebase.
//
// Two things make it worse than an ordinary arithmetic slip. It fired only
// when the live fare SUCCEEDED, so the "checked live, grounded" path
// produced a less accurate total than the guess it replaced. And
// budget_matches_items adds these same item costs up before deciding
// whether the trip fits the stated budget, so an inflated flight could
// report a perfectly affordable trip as over budget.
//
// The fare is SPLIT rather than zeroed on one side, because a flight priced
// 0 is a prices_present defect by design - zeroing the return would trade a
// money bug for a quality defect on every trip with a live fare.
//
// No network and no Amadeus key: applyFlightPricing takes an already-
// fetched fare.
//
// Run: npm run test:flight-pricing

import { applyFlightPricing, type PrefetchedFare } from "./engine/flightPricing";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryItem, TripBriefInput } from "./types";

heading("live flight pricing");

const brief = (over: Partial<TripBriefInput> = {}): TripBriefInput => ({
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2027-05-01",
  end_date: "2027-05-04",
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 3000,
  pace: "moderate",
  interests: [],
  must_see: [],
  dietary_constraints: [],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
  ...over,
});

const flight = (title: string, cost: number): ItineraryItem => ({
  time: "07:00",
  type: "transport",
  title,
  is_flight: true,
  location: "Airport",
  cost_estimate_eur: cost,
  reasoning: "the model's own hedged guess",
  source_confidence: "inferred",
  flight_search_url: "https://www.google.com/travel/flights?q=SOF-FCO",
});

const taxi = (cost: number): ItineraryItem => ({
  time: "05:00",
  type: "transport",
  title: "Taxi to the airport for the flight home",
  is_flight: false,
  location: "Rome",
  cost_estimate_eur: cost,
  reasoning: "r",
  source_confidence: "inferred",
});

/** A trip with an arrival flight on day 1 and a departure flight on the
 * last day - exactly what prompt.ts asks the model to produce. */
function roundTrip(arrivalCost = 180, returnCost = 150): Itinerary {
  return {
    budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "ok" },
    trip_summary: "s",
    key_decisions: [],
    things_to_skip: [],
    days: [
      { day: 1, date: "2027-05-01", items: [flight("Flight from Sofia to Rome", arrivalCost)], feasibility_flag: null },
      { day: 2, date: "2027-05-02", items: [], feasibility_flag: null },
      {
        day: 3,
        date: "2027-05-03",
        items: [taxi(30), flight("Flight from Rome to Sofia", returnCost)],
        feasibility_flag: null,
      },
    ],
  };
}

const fare = (over: Partial<PrefetchedFare> = {}): PrefetchedFare => ({
  fareEur: 240,
  metrics: null,
  adults: 2,
  observation: {
    originCode: "SOF",
    destinationCode: "FCO",
    departureDate: "2027-05-01",
    fareEur: 240,
    observedAt: 0,
    daysBeforeDeparture: 30,
  },
  ...over,
});

/** Every flight item's price, in day order. */
const flightPrices = (it: Itinerary): number[] =>
  it.days.flatMap((d) => d.items.filter((i) => i.is_flight === true).map((i) => i.cost_estimate_eur));

/** What the traveler is billed for, across the whole trip. */
const itemTotal = (it: Itinerary): number =>
  it.days.reduce((sum, d) => sum + d.items.reduce((s, i) => s + (i.cost_estimate_eur || 0), 0), 0);

function main() {
  section("the round trip is charged once");

  {
    // The defect, as the number it produced. A EUR 240 round trip used to
    // become 240 on arrival plus the model's own 150 still sitting on the
    // return: EUR 390 of flights for a EUR 240 fare.
    const it = roundTrip(180, 150);
    applyFlightPricing(it, brief(), fare({ fareEur: 240 }));
    check("the two legs add up to the round-trip fare", flightPrices(it).reduce((a, b) => a + b, 0) === 240, JSON.stringify(flightPrices(it)));
    check("and not to the fare plus a leg", itemTotal(it) === 240 + 30, String(itemTotal(it)));
    check("split evenly", JSON.stringify(flightPrices(it)) === "[120,120]", JSON.stringify(flightPrices(it)));
  }

  {
    // An odd fare must not lose or gain a euro to double rounding.
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 241.4 }));
    const prices = flightPrices(it);
    check("an odd fare still sums exactly", prices[0] + prices[1] === 241, JSON.stringify(prices));
    check("and neither leg is fractional", Number.isInteger(prices[0]) && Number.isInteger(prices[1]), JSON.stringify(prices));
  }

  {
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 0.4 }));
    const prices = flightPrices(it);
    check("a tiny fare rounds to zero without going negative", prices.every((p) => p >= 0), JSON.stringify(prices));
  }

  section("both legs read as checked, and say why");

  {
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 240 }));
    const [arrival, ret] = it.days.flatMap((d) => d.items.filter((i) => i.is_flight === true));
    check("the arrival leg is grounded", arrival.source_confidence === "grounded");
    check("the return leg is grounded too", ret.source_confidence === "grounded");
    check("the arrival says it is half", /half of today's real EUR 240 round-trip/.test(arrival.reasoning), arrival.reasoning);
    check("the return says it is not charged twice", /not charged twice/.test(ret.reasoning), ret.reasoning);
    check("the return keeps a source link", ret.source_urls?.length === 1, JSON.stringify(ret.source_urls));
  }

  {
    const it = roundTrip();
    applyFlightPricing(it, brief({ party_size: 1 }), fare({ fareEur: 240, adults: 1 }));
    const arrival = it.days[0].items[0];
    check("a solo traveler is not told 'for the group'", !/for the group/.test(arrival.reasoning), arrival.reasoning);
    const it2 = roundTrip();
    applyFlightPricing(it2, brief({ party_size: 3 }), fare({ fareEur: 240, adults: 3 }));
    check("a group is", /for the group/.test(it2.days[0].items[0].reasoning), it2.days[0].items[0].reasoning);
  }

  section("no price may ever be zero on a flight");

  {
    // prices_present treats a flight with no price as a DEFECT, which is
    // why the return leg is halved rather than zeroed.
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 240 }));
    check("neither leg is left priced at zero", flightPrices(it).every((p) => p > 0), JSON.stringify(flightPrices(it)));
  }

  section("a one-way trip keeps the whole fare on its only leg");

  {
    const it: Itinerary = {
      ...roundTrip(),
      days: [{ day: 1, date: "2027-05-01", items: [flight("Flight from Sofia to Rome", 180)], feasibility_flag: null }],
    };
    applyFlightPricing(it, brief(), fare({ fareEur: 240 }));
    check("one leg carries the whole fare", flightPrices(it)[0] === 240, JSON.stringify(flightPrices(it)));
    check("and is not described as a half", !/half of/.test(it.days[0].items[0].reasoning), it.days[0].items[0].reasoning);
  }

  {
    // A multi-day trip whose last day has no flight (the traveler is
    // staying, or the return is already booked): nothing to split with.
    const it = roundTrip();
    it.days[2].items = [taxi(30)];
    applyFlightPricing(it, brief(), fare({ fareEur: 240 }));
    check("with no return leg, the arrival keeps the whole fare", flightPrices(it)[0] === 240, JSON.stringify(flightPrices(it)));
  }

  section("what must NOT be mistaken for a flight leg");

  {
    // The bug this file's isFlightItem docstring records: "Taxi to the
    // airport for the flight home" matched a title regex FIRST and had the
    // round-trip fare written over its EUR 30.
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 240 }));
    const t = it.days[2].items.find((i) => i.is_flight !== true);
    check("a ground transfer keeps its own price", t?.cost_estimate_eur === 30, String(t?.cost_estimate_eur));
    check("and is not marked grounded", t?.source_confidence === "inferred", String(t?.source_confidence));
  }

  {
    // A Bulgarian trip: the legs are titled in Cyrillic, so only the
    // structured is_flight flag can find them.
    const it = roundTrip();
    it.days[0].items[0].title = "Полет от София до Рим";
    it.days[2].items[1].title = "Полет от Рим до София";
    applyFlightPricing(it, brief({ language: "bg" }), fare({ fareEur: 240 }));
    check("a Cyrillic-titled round trip is still split", JSON.stringify(flightPrices(it)) === "[120,120]", JSON.stringify(flightPrices(it)));
  }

  section("the typical-fare range matches what the item now shows");

  {
    // The range renders directly beneath the item's own price. These
    // metrics describe a whole round trip, so once the fare is split the
    // range has to be too - a leg showing EUR 120 under "typically EUR
    // 180-260" reads as a spectacular deal rather than half an ordinary
    // fare.
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 240, adults: 2, metrics: { firstEur: 90, thirdEur: 130 } }));
    const arrival = it.days[0].items[0];
    check("the range is per leg, like the price", arrival.fare_price_context?.typicalLowEur === 90, String(arrival.fare_price_context?.typicalLowEur));
    check("on both ends", arrival.fare_price_context?.typicalHighEur === 130, String(arrival.fare_price_context?.typicalHighEur));
    check(
      "and the shown price sits inside its own range",
      arrival.cost_estimate_eur >= (arrival.fare_price_context?.typicalLowEur ?? 0) &&
        arrival.cost_estimate_eur <= (arrival.fare_price_context?.typicalHighEur ?? 0),
      `${arrival.cost_estimate_eur} in ${arrival.fare_price_context?.typicalLowEur}-${arrival.fare_price_context?.typicalHighEur}`
    );
    check("the return leg gets the same context", it.days[2].items[1].fare_price_context?.typicalLowEur === 90);
  }

  {
    // The level is a comparison on the FULL fare, so halving both sides
    // cannot change it. EUR 240 for two adults is EUR 120 per passenger,
    // above the 90 first quartile and below the 130 third.
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 240, adults: 2, metrics: { firstEur: 90, thirdEur: 130 } }));
    check("a mid-range fare reads typical", it.days[0].items[0].fare_price_context?.level === "typical", String(it.days[0].items[0].fare_price_context?.level));

    const cheap = roundTrip();
    applyFlightPricing(cheap, brief(), fare({ fareEur: 120, adults: 2, metrics: { firstEur: 90, thirdEur: 130 } }));
    check("a cheap one reads low", cheap.days[0].items[0].fare_price_context?.level === "low", String(cheap.days[0].items[0].fare_price_context?.level));

    const dear = roundTrip();
    applyFlightPricing(dear, brief(), fare({ fareEur: 400, adults: 2, metrics: { firstEur: 90, thirdEur: 130 } }));
    check("an expensive one reads high", dear.days[0].items[0].fare_price_context?.level === "high", String(dear.days[0].items[0].fare_price_context?.level));
  }

  {
    const it = roundTrip();
    applyFlightPricing(it, brief(), fare({ fareEur: 240, metrics: null }));
    check("no metrics means no range at all", it.days[0].items[0].fare_price_context === undefined);
  }

  section("nothing to price");

  {
    const it = roundTrip();
    const before = JSON.stringify(it);
    applyFlightPricing(it, brief(), null);
    check("a missing fare leaves the itinerary exactly as it was", JSON.stringify(it) === before);
  }

  {
    // No flight items at all - a train trip, or travel already booked.
    const it: Itinerary = {
      ...roundTrip(),
      days: [{ day: 1, date: "2027-05-01", items: [taxi(30)], feasibility_flag: null }],
    };
    applyFlightPricing(it, brief(), fare());
    check("no flight leg means nothing is rewritten", it.days[0].items[0].cost_estimate_eur === 30);
  }

  {
    let threw = false;
    try {
      applyFlightPricing({ ...roundTrip(), days: undefined as never }, brief(), fare());
    } catch {
      threw = true;
    }
    check("an itinerary with no days does not throw", threw === false);
  }

  finish();
}

main();
