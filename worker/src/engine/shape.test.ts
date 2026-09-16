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

import { assertUsableItinerary, ItineraryShapeError, normalizeItineraryShape } from "./shape";
import { deriveConfidenceTiers } from "./checks";
import { mealSlotOf } from "./quality";
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

  section("the shape every downstream stage assumes, established once");

  {
    // assertUsableItinerary THROWS on a missing items array, which is right
    // for a fresh model response - but it runs in exactly one place, the
    // single-call path. 28 places downstream walk `day.items` unguarded,
    // and what makes that safe is three separate mechanisms in three
    // separate files. normalizeItineraryShape makes it one, by repair
    // rather than rejection: by that point the trip is generated and paid
    // for, an empty day is a visible gap the quality gate already reports,
    // and a throw there loses the whole itinerary - which is the exact
    // failure assertUsableItinerary was written for.
    const it = { days: [{ day: 1, date: "2027-05-01" }, { day: 2, date: "2027-05-02", items: [{ title: "x" }] }] } as unknown as Itinerary;
    normalizeItineraryShape(it);
    check("a day with no items gets an empty array", Array.isArray(it.days[0].items), JSON.stringify(it.days[0]));
    check("and it is actually empty", (it.days[0].items?.length ?? -1) === 0, String(it.days[0].items?.length));
    check("a day that had items keeps them", (it.days[1].items?.length ?? -1) === 1, JSON.stringify(it.days[1].items));
  }

  {
    const it = { budget_feasibility: {}, days: undefined } as unknown as Itinerary;
    normalizeItineraryShape(it);
    check("a missing days array becomes an empty one", Array.isArray(it.days) && it.days.length === 0, JSON.stringify(it.days));
  }

  {
    for (const bad of [null, "nope", 42, {}]) {
      const it = { days: bad } as unknown as Itinerary;
      let threw = false;
      try {
        normalizeItineraryShape(it);
      } catch {
        threw = true;
      }
      check(`days as ${JSON.stringify(bad) ?? "null"} does not throw`, threw === false);
      check("  and is replaced with an array", Array.isArray(it.days));
    }
  }

  {
    // A day that is not an object at all must not throw here either - the
    // quality gate and assertUsableItinerary are the ones that judge it.
    const it = { days: [null, 42, { day: 1 }] } as unknown as Itinerary;
    let threw = false;
    try {
      normalizeItineraryShape(it);
    } catch {
      threw = true;
    }
    check("a non-object day does not throw", threw === false);
    check("while a real day beside it is still repaired", Array.isArray((it.days[2] as { items?: unknown }).items));
  }

  {
    // Idempotent, because it runs on a path that may already be clean.
    //
    // Compared after ONE pass rather than before any, because the first pass
    // legitimately changes things - a day with no items array gains one, an
    // item with no readable price gains a zero. What idempotence means is
    // that the second pass changes nothing, which is what this asserts.
    const it = { days: [{ day: 1, date: "d", items: [{ title: "a" }] }] } as unknown as Itinerary;
    normalizeItineraryShape(it);
    const afterOne = JSON.stringify(it);
    normalizeItineraryShape(it);
    check("running it a second time changes nothing", JSON.stringify(it) === afterOne, JSON.stringify(it));

    const clean = { days: [{ day: 1, date: "d", items: [{ title: "a", cost_estimate_eur: 20 }] }] } as unknown as Itinerary;
    const cleanBefore = JSON.stringify(clean);
    normalizeItineraryShape(clean);
    check("an already-clean itinerary is untouched", JSON.stringify(clean) === cleanBefore, JSON.stringify(clean));
  }

  section("every price made a number");

  {
    // The other half of what this function guarantees, and the same
    // argument: 30-odd readers believe `cost_estimate_eur: number` because
    // types.ts says so, and the value arrived through a type assertion.
    // See engine/money.ts for what `"20"` did to the trip total.
    const it = {
      budget_feasibility: { feasible: true, min_realistic_total_eur: 1200, reasoning: "" },
      days: [
        {
          day: 1,
          date: "d",
          items: [
            { title: "text price", cost_estimate_eur: "20" },
            { title: "decorated", cost_estimate_eur: "EUR 140" },
            { title: "a range", cost_estimate_eur: "15-20" },
            { title: "prose", cost_estimate_eur: "about twenty" },
            { title: "missing" },
            { title: "null", cost_estimate_eur: null },
            { title: "negative", cost_estimate_eur: -30 },
            { title: "nan", cost_estimate_eur: Number.NaN },
            { title: "real", cost_estimate_eur: 28 },
            { title: "really free", cost_estimate_eur: 0 },
          ],
        },
      ],
    } as unknown as Itinerary;
    normalizeItineraryShape(it);
    const prices = it.days[0].items.map((i) => i.cost_estimate_eur);
    check("every price is a number now", prices.every((p) => typeof p === "number"), JSON.stringify(prices));
    check("  and every one is finite", prices.every((p) => Number.isFinite(p)), JSON.stringify(prices));
    check('"20" recovers to 20', prices[0] === 20, String(prices[0]));
    check('"EUR 140" recovers to 140', prices[1] === 140, String(prices[1]));
    // Not 15, and not 20. Picking an end of the range would invent a price.
    check('"15-20" becomes 0, not one end of the range', prices[2] === 0, String(prices[2]));
    check("prose becomes 0", prices[3] === 0, String(prices[3]));
    check("missing becomes 0", prices[4] === 0, String(prices[4]));
    check("null becomes 0", prices[5] === 0, String(prices[5]));
    check("negative becomes 0 - a line item may not subtract", prices[6] === 0, String(prices[6]));
    check("NaN becomes 0", prices[7] === 0, String(prices[7]));
    check("a real price is left exactly alone", prices[8] === 28, String(prices[8]));
    check("and a real zero stays zero", prices[9] === 0, String(prices[9]));

    // The property all of it is for: the total can be added up.
    const total = it.days.reduce((s, d) => s + d.items.reduce((t, i) => t + i.cost_estimate_eur, 0), 0);
    check("the trip total is a number", typeof total === "number" && Number.isFinite(total), JSON.stringify(total));
    check("  and it is 20+140+28 = 188", total === 188, String(total));
  }

  {
    // min_realistic_total_eur is treated the OPPOSITE way, and the reason is
    // its reader: ItineraryResult prints the minimum-estimate line only if
    // Number.isFinite passes. Recovering "1200" puts a line back that a paid
    // itinerary would otherwise drop; writing 0 for an unreadable one would
    // pass that guard and state a minimum of EUR 0 as fact.
    const recovered = { budget_feasibility: { min_realistic_total_eur: "1,200" }, days: [] } as unknown as Itinerary;
    normalizeItineraryShape(recovered);
    check("a text minimum estimate is recovered", recovered.budget_feasibility.min_realistic_total_eur === 1200, String(recovered.budget_feasibility.min_realistic_total_eur));

    const unreadable = { budget_feasibility: { min_realistic_total_eur: "about 1200" }, days: [] } as unknown as Itinerary;
    normalizeItineraryShape(unreadable);
    check(
      "an unreadable one is left unreadable, so the page hides the line",
      Number.isFinite(unreadable.budget_feasibility.min_realistic_total_eur) === false,
      JSON.stringify(unreadable.budget_feasibility.min_realistic_total_eur)
    );

    // And it must not throw on the shapes assertUsableItinerary rejects,
    // because this function repairs rather than rejects.
    for (const bad of [null, undefined, "feasible", 42]) {
      const it = { budget_feasibility: bad, days: [] } as unknown as Itinerary;
      let threw = false;
      try {
        normalizeItineraryShape(it);
      } catch {
        threw = true;
      }
      check(`budget_feasibility as ${JSON.stringify(bad) ?? "undefined"} does not throw`, threw === false);
    }
  }

  section("the strings, which is the one that discards a paid trip");

  {
    // `time`, `title`, `location` and `reasoning` are declared required
    // strings on ItineraryItem and arrive through `JSON.parse(text) as
    // ItineraryDay`. Measured, with `"time": 1300` - a model asked for a
    // clock time writing a number:
    //
    //   mealSlotOf    THREW: time.toLowerCase is not a function
    //   assessQuality THREW: time.toLowerCase is not a function
    //
    // The gate runs last, inside processJob's try and outside every retry,
    // so its throw marks a fully generated, FULLY PAID itinerary
    // "Unexpected error generating itinerary".
    const it = {
      days: [
        {
          day: 1,
          items: [
            { time: 1300, title: "Roscioli", location: "Rome", reasoning: "r" },
            { time: { start: "13:00" }, title: { text: "Lunch" }, location: ["Rome"], reasoning: 42 },
            { time: true, title: null, location: undefined },
            { time: "13:00", title: "Real", location: "Centro, Rome", reasoning: "because" },
          ],
        },
      ],
    } as unknown as Itinerary;
    normalizeItineraryShape(it);
    const items = it.days[0].items;
    check(
      "every time is a string now",
      items.every((i) => typeof i.time === "string"),
      JSON.stringify(items.map((i) => i.time))
    );
    const stringOrAbsent = (v: unknown) => v === undefined || typeof v === "string";
    check(
      "every title, location and reasoning is a string or absent",
      items.every((i) => stringOrAbsent(i.title) && stringOrAbsent(i.location) && stringOrAbsent(i.reasoning)),
      JSON.stringify(items.map((i) => [i.title, i.location, i.reasoning]))
    );
    // ABSENT is left absent, which is the deliberate half. Every reader of
    // these fields guards falsiness, so `undefined` returns null or "" or
    // renders as nothing - only a wrong TYPE throws. Coercing absence too
    // would rewrite items that had nothing wrong with them and cost the
    // no-op property that makes this safe to run twice.
    check("an item that never had `reasoning` does not gain one", items[2].reasoning === undefined, JSON.stringify(items[2]));
    // "" and not a placeholder: inventing a value would put words in the
    // model's mouth on the traveller's page.
    check("a number time becomes empty, not \"1300\"", items[0].time === "", JSON.stringify(items[0].time));
    check("an object title becomes empty", items[1].title === "", JSON.stringify(items[1].title));
    check("and the real item is untouched", items[3].time === "13:00" && items[3].title === "Real", JSON.stringify(items[3]));

    // The property all of it is for: the things that threw, don't.
    let threw = false;
    try {
      for (const day of it.days) {
        for (const item of day.items) {
          // `?? ""` is what every real reader does with absence, and it is
          // absence alone that needs it now.
          void `${(item.time ?? "").toLowerCase()} ${(item.title ?? "").toLowerCase()} ${(item.location ?? "").toLowerCase()}`;
        }
      }
    } catch {
      threw = true;
    }
    check("every string field can be lowercased behind the existing `?? \"\"` guards", threw === false);

    // And through the primitive that actually threw, unguarded, which is
    // how the gate lost a paid trip. (timeOrder is the other one and lives
    // in index.ts, which cannot be imported here without starting the
    // worker - it takes `unknown` and checks now, same as parseHour.)
    threw = false;
    try {
      for (const item of it.days[0].items) void (mealSlotOf(item) ?? "");
    } catch {
      threw = true;
    }
    check("mealSlotOf no longer throws on any of them", threw === false);
  }

  {
    // venue_name is `string | null`, and null is what every reader treats
    // as "this item names no business" - so an unusable one becomes null
    // rather than "", which would be a named venue with no name and would
    // keep the item in the verification pass.
    const it = {
      days: [
        {
          day: 1,
          items: [
            { venue_name: ["Roscioli", "Da Enzo"] },
            { venue_name: 42 },
            { venue_name: "   " },
            { venue_name: "" },
            { venue_name: null },
            { venue_name: "Roscioli" },
            { title: "never named one" },
          ],
        },
      ],
    } as unknown as Itinerary;
    normalizeItineraryShape(it);
    const names = it.days[0].items.map((i) => i.venue_name);
    check("a shortlist becomes null", names[0] === null, JSON.stringify(names[0]));
    check("a number becomes null", names[1] === null, JSON.stringify(names[1]));
    check("whitespace becomes null", names[2] === null, JSON.stringify(names[2]));
    check("an empty string becomes null", names[3] === null, JSON.stringify(names[3]));
    check("null stays null", names[4] === null);
    check("a real name survives", names[5] === "Roscioli", JSON.stringify(names[5]));
    check("and an item that never had the field does not gain one", names[6] === undefined, JSON.stringify(names[6]));

    // `.toLowerCase()` on this field runs in four places including the
    // gate, and `.trim()` in two more.
    let threw = false;
    try {
      for (const i of it.days[0].items) if (i.venue_name) void i.venue_name.toLowerCase().trim();
    } catch {
      threw = true;
    }
    check("so claimedVenues.add(item.venue_name.toLowerCase()) cannot throw", threw === false);
  }

  section("citations, so the trust tier cannot be earned by a long URL");

  {
    // deriveConfidenceTiers counts this field's `.length`. On a STRING that
    // is the character count, so one URL written as a bare string measured
    // 45, cleared the ">= 2" test and, with source_agreement "agree", was
    // stamped "verified" - the tier that means two independent sources
    // agreed. See engine/money.ts.
    const it = {
      days: [
        {
          day: 1,
          items: [
            { title: "bare string", source_urls: "https://www.booking.com/hotel/it/example.html" },
            { title: "two real", source_urls: ["https://a.example", "https://b.example"] },
            { title: "one real, one apology", source_urls: ["https://a.example", "(none found)"] },
            { title: "not a url", source_urls: ["booking.com"] },
            { title: "javascript", source_urls: ["javascript:alert(1)"] },
            { title: "already empty", source_urls: [] },
            { title: "never claimed one" },
          ],
        },
      ],
    } as unknown as Itinerary;
    normalizeItineraryShape(it);
    const counts = it.days[0].items.map((i) => i.source_urls?.length ?? 0);
    check("a bare-string URL counts as no sources, not 45", counts[0] === 0, String(counts[0]));
    check("two real URLs stay two", counts[1] === 2, String(counts[1]));
    check("one real beside one apology is ONE", counts[2] === 1, String(counts[2]));
    check('"booking.com" counts as none', counts[3] === 0, String(counts[3]));
    check("javascript: counts as none", counts[4] === 0, String(counts[4]));
    check("an empty array stays empty", counts[5] === 0, String(counts[5]));

    // Absence is left absent: every reader does `?? []`, and an item that
    // never claimed a source should not gain a field saying it has none.
    check(
      "an item that never claimed a source does not gain the field",
      it.days[0].items[6].source_urls === undefined,
      JSON.stringify(it.days[0].items[6])
    );

    // Every survivor must be something the page will actually link, so the
    // tier and the citations under it cannot disagree.
    const all = it.days[0].items.flatMap((i) => i.source_urls ?? []);
    check(
      "every surviving citation is an http(s) URL",
      all.every((u) => typeof u === "string" && /^https?:\/\//.test(u)),
      JSON.stringify(all)
    );
  }

  {
    // The tier itself, through the real function, on the real shape.
    const it = {
      days: [
        {
          day: 1,
          items: [
            {
              title: "one bare-string URL",
              source_confidence: "grounded",
              source_agreement: "agree",
              source_urls: "https://www.booking.com/hotel/it/example.html",
            },
          ],
        },
      ],
    } as unknown as Itinerary;
    normalizeItineraryShape(it);
    deriveConfidenceTiers(it);
    const tier = it.days[0].items[0].confidence_tier;
    check('one source is not "verified"', tier !== "verified", String(tier));
    check('  it is "fact_grounded" - grounded, with nothing to cite', tier === "fact_grounded", String(tier));
  }

  {
    // A price on a non-object item must not throw either - the items array
    // is the model's, and nothing says its entries are objects.
    const it = { days: [{ day: 1, items: [null, "lunch", 42, { title: "real", cost_estimate_eur: "12" }] }] } as unknown as Itinerary;
    let threw = false;
    try {
      normalizeItineraryShape(it);
    } catch {
      threw = true;
    }
    check("a non-object item does not throw", threw === false);
    check("  and the real item beside it is still normalized", it.days[0].items[3].cost_estimate_eur === 12, JSON.stringify(it.days[0].items[3]));
  }

  {
    // The property that makes the 28 unguarded dereferences safe: after
    // this, iterating every day's items cannot throw.
    const it = { days: [{ day: 1 }, { day: 2, items: [{ title: "x" }] }, { day: 3 }] } as unknown as Itinerary;
    normalizeItineraryShape(it);
    let walked = 0;
    let threw = false;
    try {
      for (const day of it.days) for (const _item of day.items) walked++;
    } catch {
      threw = true;
    }
    check("every day's items can be walked without a guard", threw === false);
    check("and the real item is still there", walked === 1, String(walked));
  }

  finish();
}

main();
