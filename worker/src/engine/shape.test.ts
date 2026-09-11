// Tests the shape gate on the single-call path.
//
// This was found by asking "what could still go wrong with a real trip"
// after three rounds of review, and it is the most expensive remaining
// failure in the pipeline: the single-call fallback and every refinement did
// `JSON.parse(text) as Itinerary` and returned it. A type assertion, not a
// check.
//
// A response missing `days`, or carrying one day without an `items` array,
// therefore reached normalizeLodgingPrices - which iterates both - threw
// inside processJob's try, and the traveler was shown "Unexpected error
// generating itinerary" for a trip that had already been generated and paid
// for in full. Worse, since nothing DETECTED the malformation, the one
// retry wrapping both call sites never fired, even though malformed model
// output is exactly the non-deterministic thing a retry fixes.
//
// Run: npm run test:shape

import { assertUsableItinerary, ItineraryShapeError } from "./shape";
import { check, finish, heading, section } from "../testutil";
import type { Itinerary, ItineraryItem } from "../types";

heading("itinerary shape gate");

const item = (title: string): ItineraryItem => ({
  time: "09:00",
  type: "activity",
  title,
  location: "Rome",
  cost_estimate_eur: 20,
  reasoning: "r",
  source_confidence: "grounded",
});

/** A minimal itinerary that must pass - the gate checks shape, not quality,
 * so anything structurally sound has to get through. */
const good = (): Itinerary => ({
  budget_feasibility: { feasible: true, min_realistic_total_eur: 1200, reasoning: "It works." },
  trip_summary: "Four days in Rome.",
  key_decisions: [],
  things_to_skip: [],
  days: [
    { day: 1, date: "2026-04-10", items: [item("Colosseum")], feasibility_flag: null },
    { day: 2, date: "2026-04-11", items: [], feasibility_flag: null },
  ],
});

/** The error message, or null if it passed. */
function rejection(value: unknown): string | null {
  try {
    assertUsableItinerary(value);
    return null;
  } catch (e) {
    if (e instanceof ItineraryShapeError) return e.message;
    throw e;
  }
}

async function main() {
  section("what must get through");

  check("a structurally sound itinerary passes", rejection(good()) === null, String(rejection(good())));

  // A day with zero items is legitimate - the gate's day_not_empty check and
  // the repair stage handle a thin day. Rejecting it here would turn a
  // repairable itinerary into a failed generation, which is the opposite of
  // the point.
  const empty = good();
  empty.days[0].items = [];
  check("a day with an EMPTY items array passes - thin is not malformed", rejection(empty) === null, String(rejection(empty)));

  // Quality problems are somebody else's job. If the shape gate started
  // rejecting these, a fixable trip would be thrown away.
  const poor = good();
  poor.trip_summary = "";
  poor.key_decisions = [];
  poor.budget_feasibility = { feasible: false, min_realistic_total_eur: 0, reasoning: "" };
  check("a POOR but well-formed itinerary passes", rejection(poor) === null, String(rejection(poor)));

  section("the failure that discarded a paid generation");

  // The exact shape: parses as JSON, missing the one array five readers
  // walk unguarded.
  const noItems = { ...good(), days: [{ day: 1, date: "2026-04-10", feasibility_flag: null }] };
  const noItemsMsg = rejection(noItems);
  check("a day with no items array is rejected", noItemsMsg !== null, String(noItemsMsg));
  check("and the message names the day", noItemsMsg !== null && noItemsMsg.includes("1"), String(noItemsMsg));

  check("items as null", rejection({ ...good(), days: [{ day: 1, date: "d", items: null, feasibility_flag: null }] }) !== null);
  check("items as an object", rejection({ ...good(), days: [{ day: 1, date: "d", items: {}, feasibility_flag: null }] }) !== null);
  check("items as a string", rejection({ ...good(), days: [{ day: 1, date: "d", items: "none", feasibility_flag: null }] }) !== null);

  // Only the SECOND day is malformed - every day has to be checked, not
  // just the first, or a 5-day trip loses its last day silently.
  const secondBad = {
    ...good(),
    days: [
      { day: 1, date: "2026-04-10", items: [item("Colosseum")], feasibility_flag: null },
      { day: 2, date: "2026-04-11", feasibility_flag: null },
    ],
  };
  check("a malformed day LATER in the trip is caught", rejection(secondBad) !== null, String(rejection(secondBad)));

  section("no days at all");

  check("days missing", rejection({ budget_feasibility: {}, trip_summary: "s" }) !== null);
  check("days as null", rejection({ ...good(), days: null }) !== null);
  check("days as an object", rejection({ ...good(), days: {} }) !== null);
  // An empty days array would render as a cover and a budget line and read
  // as a finished trip.
  check("days empty", rejection({ ...good(), days: [] }) !== null);
  check("a day that is not an object", rejection({ ...good(), days: ["monday"] }) !== null);
  check("a day that is null", rejection({ ...good(), days: [null] }) !== null);

  section("budget_feasibility");

  check("missing", rejection({ ...good(), budget_feasibility: undefined }) !== null);
  check("null", rejection({ ...good(), budget_feasibility: null }) !== null);
  check("a string", rejection({ ...good(), budget_feasibility: "feasible" }) !== null);

  section("things that are not itineraries at all");

  check("null", rejection(null) !== null);
  check("undefined", rejection(undefined) !== null);
  check("a string", rejection("here is your trip") !== null);
  check("a number", rejection(42) !== null);
  // A bare array is an object to typeof, so it needs its own check - a model
  // returning just the days array is a plausible malformation.
  check("a bare array", rejection([{ day: 1, items: [] }]) !== null);

  finish();
}

main();
