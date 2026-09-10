// Guards the generation-path defects found by a full review of index.ts,
// twoPhase.ts and checks.ts - every one of which the six existing suites
// passed straight over.
//
// They share a shape worth naming: none of them threw, none of them logged
// an error, and each produced an itinerary that looked finished and was
// quietly wrong about money, about what the traveler would read, or about
// which code path ran. That is the class this file exists to hold shut.
//
// Run: npm run test:generation

import { applyVerifiedAccommodation, isUsableFrame, isUsablePlan, requiredMeals } from "./engine/twoPhase";
import type { SkeletonAccommodation, SkeletonDay } from "./engine/twoPhase";
import { checkBudgetIntegrity } from "./engine/checks";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryItem, TripBriefInput } from "./types";

heading("generation path");

const brief = (over: Partial<TripBriefInput> = {}): TripBriefInput => ({
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2027-05-01",
  end_date: "2027-05-06", // five nights
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

const bed = (title: string, time: string): ItineraryItem => ({
  time,
  type: "lodging",
  title,
  venue_name: "Hotel X",
  location: "Rome",
  cost_estimate_eur: 160,
  reasoning: "r",
  source_confidence: "grounded",
});

const tripWithBedsOn = (nights: number[], arrival = 0): Itinerary => ({
  budget_feasibility: { feasible: true, min_realistic_total_eur: 1000, reasoning: "r" },
  trip_summary: "s",
  key_decisions: [],
  things_to_skip: [],
  days: [1, 2, 3, 4, 5, 6].map((d) => ({
    day: d,
    date: `2027-05-0${d}`,
    feasibility_flag: null,
    items: !nights.includes(d)
      ? []
      : [d === (arrival || nights[0]) ? bed("Check in to Hotel X", "15:00") : bed("Another night at Hotel X", "21:00")],
  })),
});

const bedsOf = (it: Itinerary) => it.days.flatMap((d) => d.items.filter((i) => i.type === "lodging"));

section("the trip's budget minimum is reconciled with the verified rate");

// The correction used the entry's CURRENT price as its baseline, and by the
// time it ran that price was already the verified one - on both paths. So
// the delta was always verified minus verified, and the trip page showed a
// minimum priced from a guess beside items priced from a source, with
// `feasible` decided against the guess.
{
  const days: SkeletonDay[] = [1, 2, 3, 4, 5].map((d) => ({
    day: d,
    date: `2027-05-0${d}`,
    city: "Rome",
    theme: "t",
    include_lodging: true,
    anchors: [],
    meals: ["breakfast", "lunch", "dinner"],
    transport_note: null,
  }));
  const accommodation: SkeletonAccommodation[] = [
    { city: "Rome", name: "guess", area: null, cost_per_night_eur: 90, source_confidence: "inferred", source_urls: [] },
  ];
  const skeleton = {
    days,
    accommodation,
    budget_feasibility: { feasible: true, min_realistic_total_eur: 1500, reasoning: "r" },
  };
  // The REAL call sequence, which is the only place this bug lives. On the
  // waitedForFrame path the function is called once before the frame's
  // budget exists - that call has nothing to correct but does overwrite the
  // entry's price - and again afterwards with the budget. A test that calls
  // it once on a fresh skeleton cannot tell the fixed version from the
  // broken one, because the entry still holds the guess at that moment.
  const verified = {
    costPerNightEur: 160,
    name: "Hotel Artemide",
    area: "Monti",
    sourceUrls: ["https://x.invalid"],
  };
  const frameGuess = accommodation[0].cost_per_night_eur;

  // Call one: no budget on the skeleton yet, so no correction - but the
  // entry's price is replaced here, which is what used to destroy the
  // baseline.
  applyVerifiedAccommodation({ days, accommodation }, "Rome", verified);
  check("the first call takes the verified rate", accommodation[0].cost_per_night_eur === 160);

  // Call two: the frame has landed, and the baseline has to come from what
  // was captured before call one, not from the entry.
  applyVerifiedAccommodation(skeleton, "Rome", verified, frameGuess);
  check("the item still holds the verified rate", skeleton.accommodation[0].cost_per_night_eur === 160);
  check(
    "and the minimum moves by (verified - guess) x nights",
    skeleton.budget_feasibility.min_realistic_total_eur === 1850,
    `got ${skeleton.budget_feasibility.min_realistic_total_eur}, wanted 1850`
  );

  // Re-applying with no baseline must not correct anything a second time.
  const again = {
    days,
    accommodation: [{ ...accommodation[0], cost_per_night_eur: 160 }],
    budget_feasibility: { feasible: true, min_realistic_total_eur: 1850, reasoning: "r" },
  };
  applyVerifiedAccommodation(again, "Rome", {
    costPerNightEur: 160,
    name: "Hotel Artemide",
    area: null,
    sourceUrls: [],
  });
  check("no second correction when the rate already matches", again.budget_feasibility.min_realistic_total_eur === 1850);
}

section("a night the plan deliberately left bed-free stays bed-free");

// PLAN_SYSTEM tells the model to set include_lodging false for a night spent
// in transit. checkBudgetIntegrity counted nights from the DATES, so an
// overnight train produced a cloned hotel item - a fabricated bill on top of
// a total the function's own docstring promises is accurate.
{
  const filled = checkBudgetIntegrity(tripWithBedsOn([1, 2, 4, 5]), brief(), 4);
  check("no phantom night is added", bedsOf(filled).length === 4, String(bedsOf(filled).length));
  check("and the transit night has no bed", !filled.days[2].items.some((i) => i.type === "lodging"));
}

// With no plan (the single-call path, and refinements) the dates are still
// the only authority there is, and a genuine gap must still be filled.
{
  const filled = checkBudgetIntegrity(tripWithBedsOn([1, 2, 4, 5]), brief(), undefined);
  check("a real gap is still filled when there is no plan", bedsOf(filled).length === 5, String(bedsOf(filled).length));
}

// The warn branch above the fill already respected needs_lodging; the fill
// did not, so one stray lodging line on a trip with a bed already booked
// got cloned onto every remaining night.
{
  const filled = checkBudgetIntegrity(tripWithBedsOn([1]), brief({ needs_lodging: false }), undefined);
  check("a stray line is not cloned when lodging is already arranged", bedsOf(filled).length === 1, String(bedsOf(filled).length));
}

section("a cloned arrival night reads as an arrival");

// The relabel only applied to nights AFTER the first, so a clone landing on
// night 1 kept "Another night at..." at 21:00 - a stay continuing before it
// began, with no check-in anywhere in the trip.
{
  const filled = checkBudgetIntegrity(tripWithBedsOn([2, 3, 4, 5], 2), brief(), 5);
  const beds = bedsOf(filled);
  const night1 = filled.days[0].items.find((i) => i.type === "lodging");
  const night2 = filled.days[1].items.find((i) => i.type === "lodging");
  check("all five nights have a bed", beds.length === 5, String(beds.length));
  check("night 1 is the check-in", /check in/i.test(night1?.title ?? ""), JSON.stringify(night1?.title));
  check("at the check-in's own time, not 21:00", night1?.time === "15:00", night1?.time);
  check("and the night it was copied from becomes a continuation", /another night/i.test(night2?.title ?? ""), JSON.stringify(night2?.title));
  check("exactly one check-in in the trip", beds.filter((b) => /check in/i.test(b.title)).length === 1);
}

section("phase 1 is rejected when it would break something downstream");

// mergeSkeleton uses `?? []`, which only replaces null and undefined - so a
// non-array survived to the trip page, where `.length > 0 && .map(...)`
// finds a truthy length on a string and no .map. A blank page for a
// generation the traveler paid for.
{
  const base = { budget_feasibility: { feasible: true, min_realistic_total_eur: 1, reasoning: "r" }, trip_summary: "s" };
  check("a good frame passes", isUsableFrame({ ...base, accommodation: [], key_decisions: [], things_to_skip: [] }));
  check(
    "key_decisions as a string is rejected",
    !isUsableFrame({ ...base, accommodation: [], key_decisions: "none", things_to_skip: [] })
  );
  check(
    "things_to_skip as an object is rejected",
    !isUsableFrame({ ...base, accommodation: [], key_decisions: [], things_to_skip: {} })
  );
  check("a missing list is rejected", !isUsableFrame({ ...base, accommodation: [] }));
}

// city and include_lodging are both dereferenced downstream with no guard.
// A missing city throws inside the parallel path and costs a full serial
// regeneration; a missing include_lodging everywhere ships a multi-night
// trip with no accommodation and no night's cost in the total.
{
  const day = { day: 1, date: "2027-05-01", city: "Rome", include_lodging: true, anchors: [], theme: "t", meals: [], transport_note: null };
  check("a good plan passes", isUsablePlan({ days: [day] }));
  check("a day with no city is rejected", !isUsablePlan({ days: [{ ...day, city: undefined }] }));
  check("a day with no include_lodging is rejected", !isUsablePlan({ days: [{ ...day, include_lodging: undefined }] }));
  check("include_lodging as a string is rejected", !isUsablePlan({ days: [{ ...day, include_lodging: "yes" }] }));
  check("an empty plan is still rejected", !isUsablePlan({ days: [] }));
}

section("the meal fallback is a copy, not the shared array");

// The fallback is the default for every day of every job in a worker
// running four generations at once, so one caller mutating its result
// would have changed the meal contract for every in-flight day.
{
  const noMeals: SkeletonDay = {
    day: 1, date: "2027-05-01", city: "Rome", theme: "t",
    include_lodging: true, anchors: [], meals: [], transport_note: null,
  };
  const first = requiredMeals(noMeals);
  first.pop();
  const second = requiredMeals(noMeals);
  check("mutating one result does not shrink the next", second.length === 3, `got ${second.length}`);
  check("and the fallback is still all three meals", second.join(",") === "breakfast,lunch,dinner", second.join(","));
}

finish();
