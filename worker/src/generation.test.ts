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
import { isOpenAt, namesLikelyMatch, normalizeName, stripToUnverified } from "./engine/venueVerification";
import { assessQuality } from "./engine/quality";
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

section("a venue's name is compared in its own script");

// normalize() was [^a-z0-9\s] -> " ", which replaces every Cyrillic, Greek
// and CJK character with a space. So a Bulgarian name normalized to
// nothing, namesLikelyMatch returned false against a PERFECT Google match,
// and checkVenues deleted the item - every named meal and activity on a
// Bulgarian itinerary, silently.
check("identical Cyrillic names match", namesLikelyMatch("Ресторант Мазалат", "Ресторант Мазалат"));
check("a Cyrillic partial matches", namesLikelyMatch("Мазалат", "Ресторант Мазалат"));
check("different Cyrillic names still do not", !namesLikelyMatch("Витоша Хижа", "Ресторант Мазалат"));
check("identical Greek names match", namesLikelyMatch("Ελληνικό Εστιατόριο", "Ελληνικό Εστιατόριο"));
// No spaces to split on, so word overlap cannot answer it and containment can.
check("identical CJK names match", namesLikelyMatch("寿司さいとう", "寿司さいとう"));
check("different CJK names do not", !namesLikelyMatch("寿司さいとう", "ラーメン一蘭"));
check("the documented Latin case still works", namesLikelyMatch("Restaurante Vegetariano Apfel", "Apfel Vegetariano"));
check("a wrong business is still rejected", !namesLikelyMatch("Roscioli", "Joe's Diner"));
check("accents are still folded", normalizeName("Café Ñandú") === "cafe nandu", normalizeName("Café Ñandú"));

section("a 12-hour clock time is not read as morning");

// The schema asks for HH:MM and nothing enforces it. "7:30 PM" parsed to
// 450 minutes - half past seven in the MORNING - so a dinner was measured
// against a restaurant's evening hours, found closed, and deleted.
{
  const evening = {
    regularOpeningHours: {
      periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        open: { day: d, hour: 18, minute: 0 },
        close: { day: d, hour: 23, minute: 0 },
      })),
    },
  };
  check("19:30 is open", isOpenAt(evening as never, "2027-05-03", "19:30") === true);
  check('"7:30 PM" is open too', isOpenAt(evening as never, "2027-05-03", "7:30 PM") === true);
  check('"7:30 pm" lowercase', isOpenAt(evening as never, "2027-05-03", "7:30 pm") === true);
  check('"7:30 AM" is correctly closed', isOpenAt(evening as never, "2027-05-03", "7:30 AM") === false);
  check('"12:30 AM" is midnight, not midday', isOpenAt(evening as never, "2027-05-03", "12:30 AM") === false);
}

section("a rejected venue leaves nothing behind to plot or photograph");

// applyPlaceData writes coordinates and a photo name BEFORE the confidence
// checks run, and stripToUnverified did not clear them - so the map still
// pinned, and the day still showed a photograph of, the exact business
// whose name had just been stripped because it could not be stood behind.
{
  const item: ItineraryItem = {
    time: "20:00", type: "meal", title: "Dinner", venue_name: "Somewhere",
    location: "Rome", cost_estimate_eur: 30, reasoning: "r", source_confidence: "grounded",
    google_lat: 41.9, google_lng: 12.5, google_photo_name: "places/x/photos/y",
    google_rating: 4.6, google_maps_url: "https://maps.google.com/?cid=1",
  };
  stripToUnverified(item);
  check("no coordinates survive", item.google_lat === undefined && item.google_lng === undefined);
  check("no photo survives", item.google_photo_name === undefined);
  check("and the rating and link still go", item.google_rating === undefined && item.google_maps_url === undefined);
}

section("the quality gate does not report false defects");

// Both of these fire on trips the pipeline is meant to support, and neither
// can be repaired - so they became permanent failures in the rolling
// counters for itineraries that were correct.
{
  const plan: SkeletonDay[] = [1, 2, 3, 4].map((d) => ({
    day: d, date: `2027-05-0${d}`, city: "Rome", theme: "t",
    // Night 3 is spent on a train, exactly as PLAN_SYSTEM instructs.
    include_lodging: d !== 3 && d !== 4,
    anchors: [], meals: ["breakfast", "lunch", "dinner"], transport_note: null,
  }));
  const activity = (title: string): ItineraryItem => ({
    time: "10:00", type: "activity", title, venue_name: title, location: "Rome",
    cost_estimate_eur: 10, reasoning: "r", source_confidence: "grounded",
  });
  const train = (): ItineraryItem => ({
    time: "22:00", type: "transport", title: "Night train to Vienna", venue_name: null,
    location: "Rome", cost_estimate_eur: 60, reasoning: "r", source_confidence: "inferred",
    is_flight: false,
  });
  const itinerary: Itinerary = {
    budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "r" },
    trip_summary: "s", key_decisions: [], things_to_skip: [],
    days: [1, 2, 3, 4].map((d) => ({
      day: d, date: `2027-05-0${d}`, feasibility_flag: null,
      items: [
        ...(d === 1 ? [train()] : []),
        activity(`Sight ${d}`),
        ...(d === 2 ? [activity("Second sight")] : []),
        ...(plan[d - 1].include_lodging ? [bed("Check in to Hotel X", "15:00")] : []),
      ],
    })),
  };
  const report = assessQuality(itinerary, brief({ end_date: "2027-05-05" }), plan);
  const lodgingDefect = report.findings.find((f) => f.check === "lodging_per_night");
  check(
    "two beds for a plan asking for two is not a defect",
    lodgingDefect === undefined,
    JSON.stringify(lodgingDefect?.detail)
  );
  // Day 1 carries a rail journey and one activity. Keying the exemption on
  // is_flight held it to the full-day floor and reported a defect.
  const emptyDay1 = report.findings.find((f) => f.check === "day_not_empty" && f.day === 1);
  check(
    "a rail arrival day is exempt like a flight one",
    emptyDay1 === undefined,
    JSON.stringify(emptyDay1?.detail)
  );
}

finish();
