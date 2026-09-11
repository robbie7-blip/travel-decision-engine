// Per-night accommodation pricing - the largest line in the itinerary.
//
// The last gap I named as untested. normalizeLodgingPrices rewrites the
// nightly rate on every lodging item to match the verified figure, and it
// reaches perNightRateFor, where two shipped defects lived:
//
//   - `"x".includes("")` is TRUE, so an accommodation entry with city ""
//     was the first match for EVERY lodging item in the trip. Every night
//     in every city was rewritten to that entry's rate - the biggest number
//     in the itinerary, silently changed - and the lodging_price_per_night
//     check afterwards agreed with the corrupted figure, so nothing
//     complained.
//   - a MISSING city was worse: `a.city.toLowerCase()` threw inside
//     processJob's try, so a fully generated, fully paid itinerary was
//     discarded and the traveller was shown "Unexpected error generating
//     itinerary".
//
// isUsableFrame validates that `accommodation` is an array but nothing
// about the entries in it, so both shapes genuinely reach this code.
//
// Tested through normalizeLodgingPrices rather than perNightRateFor
// directly: that is the exported entry point and the thing processJob
// actually calls.
//
// Run: npm run test:accommodation-pricing

import { normalizeLodgingPrices } from "./engine/quality";
import { check, finish, heading, section } from "./testutil";
import type { SkeletonAccommodation } from "./engine/twoPhase";
import type { Itinerary, ItineraryItem } from "./types";

heading("per-night accommodation pricing");

const bed = (location: string, price: number): ItineraryItem => ({
  time: "22:00",
  type: "lodging",
  title: `Night in ${location}`,
  venue_name: "Hotel X",
  location,
  cost_estimate_eur: price,
  reasoning: "r",
  source_confidence: "grounded",
});

const tripOf = (items: ItineraryItem[]): Itinerary => ({
  budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "ok" },
  trip_summary: "s",
  key_decisions: [],
  things_to_skip: [],
  days: items.map((item, i) => ({ day: i + 1, date: `2026-04-1${i + 1}`, items: [item], feasibility_flag: null })),
});

const rates = (...entries: [string, number][]): SkeletonAccommodation[] =>
  entries.map(([city, cost_per_night_eur]) => ({ city, cost_per_night_eur })) as SkeletonAccommodation[];

/** Every lodging price in the trip, after normalisation. */
const pricesIn = (it: Itinerary): number[] =>
  it.days.flatMap((d) => d.items.filter((i) => i.type === "lodging").map((i) => i.cost_estimate_eur));

async function main() {
  section("the ordinary correction");

  {
    // 200 against a verified 140 is well outside tolerance, so it is
    // rewritten; the second night already matches and is left alone.
    const trip = tripOf([bed("Rome", 200), bed("Rome", 140)]);
    const n = normalizeLodgingPrices(trip, rates(["Rome", 140]));
    check("the wrong night is corrected", pricesIn(trip)[0] === 140, JSON.stringify(pricesIn(trip)));
    check("the right night is untouched", pricesIn(trip)[1] === 140);
    check("and it reports how many it changed", n === 1, String(n));
  }

  {
    const trip = tripOf([bed("Monti, Rome", 200)]);
    normalizeLodgingPrices(trip, rates(["Rome", 140]));
    check("a neighbourhood-qualified location still matches its city", pricesIn(trip)[0] === 140, JSON.stringify(pricesIn(trip)));
  }

  section("each city gets its OWN rate");

  {
    const trip = tripOf([bed("Rome", 300), bed("Florence", 300)]);
    normalizeLodgingPrices(trip, rates(["Rome", 140], ["Florence", 95]));
    check("Rome takes Rome's rate", pricesIn(trip)[0] === 140, JSON.stringify(pricesIn(trip)));
    check("Florence takes Florence's rate", pricesIn(trip)[1] === 95, JSON.stringify(pricesIn(trip)));
  }

  section("a blank city must match NOTHING, not everything");

  {
    // The defect, stated as the number it produced. "".includes("") is
    // true, so the blank entry was found first for every item and 999
    // became the rate for the whole trip.
    const trip = tripOf([bed("Rome", 140), bed("Florence", 95)]);
    normalizeLodgingPrices(trip, rates(["", 999], ["Rome", 140], ["Florence", 95]));
    check(
      "a blank-city entry does not rewrite every night",
      pricesIn(trip)[0] === 140 && pricesIn(trip)[1] === 95,
      JSON.stringify(pricesIn(trip))
    );
  }

  {
    const trip = tripOf([bed("Rome", 140), bed("Florence", 95)]);
    normalizeLodgingPrices(trip, rates(["   ", 999], ["Rome", 140], ["Florence", 95]));
    check("a whitespace-only city is the same", JSON.stringify(pricesIn(trip)) === "[140,95]", JSON.stringify(pricesIn(trip)));
  }

  section("a missing city must not throw");

  {
    // `a.city.toLowerCase()` threw here, inside processJob's try - a fully
    // generated itinerary discarded as "Unexpected error generating
    // itinerary".
    const trip = tripOf([bed("Rome", 200)]);
    let threw = false;
    try {
      normalizeLodgingPrices(trip, [{ cost_per_night_eur: 500 } as unknown as SkeletonAccommodation, ...rates(["Rome", 140])]);
    } catch {
      threw = true;
    }
    check("an entry with no city at all does not throw", threw === false);
    check("and the real city rate still applies", pricesIn(trip)[0] === 140, JSON.stringify(pricesIn(trip)));
  }

  {
    const trip = tripOf([bed("Rome", 200)]);
    let threw = false;
    try {
      normalizeLodgingPrices(trip, [{ city: null, cost_per_night_eur: 500 } as unknown as SkeletonAccommodation]);
    } catch {
      threw = true;
    }
    check("a null city does not throw", threw === false);
    // One entry, so the single-entry fallback applies - but only because
    // the entry is the ONLY one, not because a null city matched.
    check("the price is either corrected or left, never NaN", Number.isFinite(pricesIn(trip)[0]), JSON.stringify(pricesIn(trip)));
  }

  section("the single-entry tolerance");

  {
    // One entry and a city that doesn't literally match: the frame and the
    // plan name cities independently, so a lone rate is applied anyway.
    const trip = tripOf([bed("Trastevere", 300)]);
    normalizeLodgingPrices(trip, rates(["Roma", 140]));
    check("a lone rate applies even when the names differ", pricesIn(trip)[0] === 140, JSON.stringify(pricesIn(trip)));
  }

  {
    // TWO entries and no match: guessing which city's rate to use would be
    // worse than leaving the model's own figure alone.
    const trip = tripOf([bed("Naples", 300)]);
    normalizeLodgingPrices(trip, rates(["Rome", 140], ["Florence", 95]));
    check("with two rates and no match, nothing is rewritten", pricesIn(trip)[0] === 300, JSON.stringify(pricesIn(trip)));
  }

  section("figures that must not be trusted in either direction");

  {
    const trip = tripOf([bed("Rome", 200)]);
    const n = normalizeLodgingPrices(trip, rates(["Rome", 0]));
    check("a verified rate of 0 corrects nothing", n === 0 && pricesIn(trip)[0] === 200, JSON.stringify(pricesIn(trip)));
  }

  {
    const trip = tripOf([bed("Rome", 0)]);
    const n = normalizeLodgingPrices(trip, rates(["Rome", 140]));
    check("an item priced 0 is left for the gate to flag, not silently filled", n === 0 && pricesIn(trip)[0] === 0, JSON.stringify(pricesIn(trip)));
  }

  {
    const trip = tripOf([bed("Rome", 200)]);
    const n = normalizeLodgingPrices(trip, []);
    check("no rates at all is a no-op", n === 0 && pricesIn(trip)[0] === 200);
  }

  {
    // Within tolerance - a small difference is the model rounding, not an
    // error worth overwriting.
    const trip = tripOf([bed("Rome", 145)]);
    const n = normalizeLodgingPrices(trip, rates(["Rome", 140]));
    check("a near-match inside tolerance is left alone", n === 0 && pricesIn(trip)[0] === 145, JSON.stringify(pricesIn(trip)));
  }

  section("only lodging items");

  {
    const trip = tripOf([bed("Rome", 200)]);
    trip.days[0].items.push({ ...bed("Rome", 70), type: "meal", title: "Dinner" });
    normalizeLodgingPrices(trip, rates(["Rome", 140]));
    const meal = trip.days[0].items.find((i) => i.type === "meal");
    check("a meal's price is never rewritten to the room rate", meal?.cost_estimate_eur === 70, String(meal?.cost_estimate_eur));
  }

  {
    let threw = false;
    try {
      normalizeLodgingPrices({ ...tripOf([]), days: undefined as never }, rates(["Rome", 140]));
    } catch {
      threw = true;
    }
    check("an itinerary with no days does not throw", threw === false);
  }

  finish();
}

main();
