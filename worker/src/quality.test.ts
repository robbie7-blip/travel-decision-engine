// Tests the acceptance gate against itineraries that are deliberately
// broken in each of the ways this product has actually shipped broken.
//
// Every fixture below is a real failure, not a hypothetical: the generic
// accommodation and the day with no lunch are the Bali trip; the venue
// used twice is the Chisinau trip; the day with a flight, a transfer and
// nothing else is Bali day 1. Each one previously reached a traveler
// because nothing in the pipeline was looking. This file is what "looking"
// means, and it runs in milliseconds with no API key.
//
// Run: npm run test:quality

import { assessQuality, normalizeLodgingPrices } from "./engine/quality";
import type { SkeletonAccommodation, SkeletonDay } from "./engine/twoPhase";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "./types";

const BRIEF: TripBriefInput = {
  destinations: ["Ubud"],
  origin: "Sofia",
  start_date: "2027-03-18",
  end_date: "2027-03-20", // two nights
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 3000,
  pace: "relaxed",
  interests: ["food"],
  must_see: [],
  dietary_constraints: [],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
};

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    time: "09:00",
    type: "activity",
    title: "Something",
    venue_name: "Some Real Place",
    location: "Ubud",
    cost_estimate_eur: 10,
    reasoning: "r",
    source_confidence: "inferred",
    confidence_tier: "fact_grounded",
    ...over,
  };
}

function meal(slot: "Breakfast" | "Lunch" | "Dinner", venue: string, time: string): ItineraryItem {
  return item({ type: "meal", title: `${slot} at ${venue}`, venue_name: venue, time, cost_estimate_eur: 15 });
}

function lodging(venue: string | null): ItineraryItem {
  return item({
    type: "lodging",
    title: venue ? `Night at ${venue}` : "Night at a mid-range hotel",
    venue_name: venue,
    time: "21:00",
    cost_estimate_eur: 65,
  });
}

/** A day with everything it should have: three named meals, an activity,
 * a bed. The baseline every fixture below deviates from by exactly one
 * thing, so a failing check names the deviation and nothing else. */
function goodDay(n: number, date: string, withLodging = true): ItineraryDay {
  // Two activities and no stretch over four hours — which is what a day
  // someone travelled for actually looks like. The earlier version of this
  // fixture had one sight and a six-hour void between lunch and dinner, and
  // called itself the baseline; the gap check caught it on its first run.
  const items = [
    meal("Breakfast", `Cafe ${n}`, "08:30"),
    item({ title: `Sight ${n}`, venue_name: `Temple ${n}`, time: "10:30" }),
    meal("Lunch", `Warung ${n}`, "13:00"),
    item({ title: `Afternoon walk ${n}`, venue_name: `Market ${n}`, time: "16:00" }),
    meal("Dinner", `Restaurant ${n}`, "19:30"),
  ];
  if (withLodging) items.push(lodging("Hotel Real"));
  return { day: n, date, items, feasibility_flag: null };
}

const DATES = ["2027-03-18", "2027-03-19", "2027-03-20"];

function plan(): SkeletonDay[] {
  return DATES.map((date, i) => ({
    day: i + 1,
    date,
    city: "Ubud",
    theme: "t",
    include_lodging: i < DATES.length - 1,
    anchors: [],
    meals: ["breakfast", "lunch", "dinner"],
    transport_note: i === 0 ? "Flight from Sofia to Denpasar" : null,
  }));
}

function itinerary(days: ItineraryDay[]): Itinerary {
  return {
    budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "r" },
    trip_summary: "s",
    key_decisions: [],
    days,
    things_to_skip: [],
  };
}

/** The clean baseline: a trip with nothing wrong with it. */
function baseline(): ItineraryDay[] {
  const days = [goodDay(1, DATES[0]), goodDay(2, DATES[1]), goodDay(3, DATES[2], false)];
  days[0].items.unshift(
    item({ type: "transport", title: "Flight to Denpasar", venue_name: null, time: "06:00", is_flight: true, cost_estimate_eur: 700 }),
    // A flight alone is not an arrival — the onward leg is part of the day.
    item({ type: "transport", title: "Car to Ubud", venue_name: null, time: "07:30", cost_estimate_eur: 25 })
  );
  return days;
}

function firedChecks2(days: ItineraryDay[], brief: TripBriefInput): string[] {
  return assessQuality(itinerary(days), brief, plan()).findings.map((f) => f.check);
}

function firedChecks(days: ItineraryDay[]): string[] {
  return assessQuality(itinerary(days), BRIEF, plan()).findings.map((f) => f.check);
}

function firedChecksWith(days: ItineraryDay[], accommodation: SkeletonAccommodation[]): string[] {
  return assessQuality(itinerary(days), BRIEF, plan(), accommodation).findings.map((f) => f.check);
}

heading("ACCEPTANCE GATE — every invariant, against a real past failure");

section("a clean itinerary passes");
{
  const report = assessQuality(itinerary(baseline()), BRIEF, plan());
  check(
    "no findings on a well-formed trip",
    report.findings.length === 0,
    report.findings.map((f) => f.detail).join("; ")
  );
  check("passed is true", report.passed);
}

section("missing meals — the Bali day-02 failure");
{
  const days = baseline();
  // Day 2 goes from a morning sight straight to the hotel.
  days[1].items = days[1].items.filter((i) => i.type !== "meal" || i.time === "08:30");
  const fired = firedChecks(days);
  check("meals_present fires", fired.includes("meals_present"));
  const report = assessQuality(itinerary(days), BRIEF, plan());
  const finding = report.findings.find((f) => f.check === "meals_present");
  check("names the day and both missing meals", finding?.detail === "day 2 has no lunch and no dinner", finding?.detail);
  check("counts as a defect, not a warning", finding?.severity === "defect");
  check("report does not pass", !report.passed);
}

section("meals identified by clock time, not just by the word");
{
  const days = baseline();
  // Same three meals, none of them named "lunch" — a Bulgarian-language
  // trip writes none of these words, so the gate must not depend on them.
  days[1].items = [
    item({ type: "meal", title: "Баница и кафе", venue_name: "A", time: "08:30", cost_estimate_eur: 8 }),
    item({ title: "Sight", venue_name: "Temple X", time: "11:00" }),
    item({ type: "meal", title: "Нещо топло", venue_name: "B", time: "13:30", cost_estimate_eur: 14 }),
    item({ type: "meal", title: "Ядене", venue_name: "C", time: "20:00", cost_estimate_eur: 22 }),
    lodging("Hotel Real"),
  ];
  check("no false meal gap on a non-English day", !firedChecks(days).includes("meals_present"));
}

section("duplicate venue — the Chisinau failure");
{
  const days = baseline();
  (days[2].items.find((i) => i.type === "meal") as ItineraryItem).venue_name = "Cafe 1";
  const fired = firedChecks(days);
  check("no_duplicate_venues fires", fired.includes("no_duplicate_venues"));

  // The bug this file caught on its first run. The same hotel every night
  // is the correct itinerary, and because repairDuplicateVenues shares this
  // detector, counting it would have moved the traveler to a different
  // hotel on night two.
  const sameHotel = baseline();
  check(
    "the same accommodation on consecutive nights is NOT a duplicate",
    !firedChecks(sameHotel).includes("no_duplicate_venues"),
    firedChecks(sameHotel).join(", ")
  );

  // Same reasoning for the airport you fly home from.
  const returnLeg = baseline();
  returnLeg[2].items.unshift(
    item({ type: "transport", title: "Flight home from Denpasar", venue_name: "Denpasar Airport", time: "18:00", is_flight: true, cost_estimate_eur: 700 })
  );
  returnLeg[0].items[0].venue_name = "Denpasar Airport";
  check(
    "the same airport on both legs is NOT a duplicate",
    !firedChecks(returnLeg).includes("no_duplicate_venues")
  );
}

section("generic accommodation — the Bali hotel failure");
{
  const days = baseline();
  for (const day of days) {
    for (const it of day.items) if (it.type === "lodging") it.venue_name = null;
  }
  const report = assessQuality(itinerary(days), BRIEF, plan());
  const finding = report.findings.find((f) => f.check === "lodging_named");
  check("lodging_named fires", !!finding);
  check(
    "is a warning, not a defect — sometimes there is genuinely no property to name",
    finding?.severity === "warning"
  );
  check("a warning alone still passes the gate", report.passed);
}

section("wrong number of nights");
{
  const days = baseline();
  days[1].items = days[1].items.filter((i) => i.type !== "lodging");
  const report = assessQuality(itinerary(days), BRIEF, plan());
  const finding = report.findings.find((f) => f.check === "lodging_per_night");
  check("lodging_per_night fires", !!finding);
  check("says how many it found vs needed", finding?.detail === "1 accommodation item(s) for a 2-night trip", finding?.detail);
}

section("a day with nothing to do — the Bali day-01 failure");
{
  const days = baseline();
  // Flight, transfer, hotel. No activity, no meals.
  days[0].items = [
    item({ type: "transport", title: "Flight to Denpasar", venue_name: null, time: "06:00", is_flight: true, cost_estimate_eur: 700 }),
    item({ type: "transport", title: "Car to Ubud", venue_name: null, time: "17:00", cost_estimate_eur: 25 }),
    lodging("Hotel Real"),
  ];
  const fired = firedChecks(days);
  check("day_not_empty fires", fired.includes("day_not_empty"));
  check("meals_present also fires on the same day", fired.includes("meals_present"));
}

section("prices");
{
  const days = baseline();
  (days[1].items.find((i) => i.type === "meal") as ItineraryItem).cost_estimate_eur = 0;
  check("prices_present fires on a free meal", firedChecks(days).includes("prices_present"));

  const free = baseline();
  free[1].items.push(item({ title: "Walk through the rice fields", venue_name: null, cost_estimate_eur: 0, time: "16:00" }));
  check(
    "a genuinely free activity is NOT a price defect",
    !firedChecks(free).includes("prices_present")
  );
}

section("transport legs");
{
  const days = baseline();
  days[0].items = days[0].items.filter((i) => i.type !== "transport");
  check("transport_legs fires when an origin was given", firedChecks(days).includes("transport_legs"));

  const noFlightBrief: TripBriefInput = { ...BRIEF, needs_flight: false };
  const report = assessQuality(itinerary(days), noFlightBrief, plan());
  check(
    "does not fire when the brief says travel is already arranged",
    !report.findings.some((f) => f.check === "transport_legs")
  );
}

section("closed when we send them");
{
  const days = baseline();
  // checkVenues should have removed this; the gate is the backstop for
  // anything that gets past it.
  (days[1].items.find((i) => i.type === "meal") as ItineraryItem).google_open_on_visit = false;
  const report = assessQuality(itinerary(days), BRIEF, plan());
  const finding = report.findings.find((f) => f.check === "open_on_visit");
  check("open_on_visit fires", !!finding);
  check("counts as a defect", finding?.severity === "defect");

  const unknown = baseline();
  (unknown[1].items.find((i) => i.type === "meal") as ItineraryItem).google_open_on_visit = undefined;
  check(
    "a venue with no published hours is NOT flagged",
    !firedChecks(unknown).includes("open_on_visit")
  );
}

section("the things the traveler actually asked for");
{
  const wantsTrevi: TripBriefInput = { ...BRIEF, must_see: ["Trevi Fountain", "Pantheon"] };
  const days = baseline();

  // Nothing in the trip mentions either — the worst silent failure there is.
  let report = assessQuality(itinerary(days), wantsTrevi, plan());
  const dropped = report.findings.filter((f) => f.check === "must_see_covered");
  check("both dropped must-sees are reported", dropped.length === 2, `${dropped.length}`);
  check("as defects", dropped.every((f) => f.severity === "defect"));

  // Present as an item — covered.
  const withTrevi = baseline();
  withTrevi[1].items.push(item({ title: "Toss a coin at the Trevi Fountain", venue_name: "Trevi Fountain", time: "17:00" }));
  withTrevi[1].items.push(item({ title: "Visit the Pantheon", venue_name: "Pantheon", time: "11:00" }));
  check(
    "a must-see written into the days is covered",
    !firedChecks2(withTrevi, wantsTrevi).includes("must_see_covered")
  );

  // Explained away in the skip list — allowed, because it was said out loud.
  const explained = itinerary(baseline());
  explained.things_to_skip = [
    { item: "Trevi Fountain", reasoning: "Rebuilt scaffolding all November, nothing to see" },
    { item: "Pantheon", reasoning: "Closed for restoration on both free days" },
  ];
  check(
    "a must-see openly skipped is NOT a silent drop",
    !assessQuality(explained, wantsTrevi, plan()).findings.some((f) => f.check === "must_see_covered")
  );

  // Loose matching: how someone types it vs how the itinerary writes it.
  const loose = baseline();
  loose[1].items.push(item({ title: "Colosseum, Roman Forum and Palatine Hill", venue_name: "Colosseo", time: "11:00" }));
  check(
    "'the colosseum' matches 'Colosseum, Roman Forum and Palatine Hill'",
    !firedChecks2(loose, { ...BRIEF, must_see: ["the colosseum"] }).includes("must_see_covered")
  );
}

section("the budget stamp against the actual bill");
{
  const days = baseline();
  const tight: TripBriefInput = { ...BRIEF, budget_total_eur: 100 };
  const report = assessQuality(itinerary(days), tight, plan());
  const finding = report.findings.find((f) => f.check === "budget_matches_items");
  check("a 'feasible' trip whose items exceed the budget is a defect", !!finding);
  check("severity is defect", finding?.severity === "defect");
  check("the detail names both numbers", finding?.detail.includes("100") === true, finding?.detail);

  check(
    "comfortably under budget does not fire",
    !firedChecks2(days, { ...BRIEF, budget_total_eur: 100000 }).includes("budget_matches_items")
  );

  const infeasible = itinerary(baseline());
  infeasible.budget_feasibility = { feasible: false, min_realistic_total_eur: 900, reasoning: "r" };
  check(
    "an honestly-infeasible trip is not also flagged — it already said so",
    !assessQuality(infeasible, tight, plan()).findings.some((f) => f.check === "budget_matches_items")
  );

  check(
    "no stated budget means nothing to check against",
    !firedChecks2(days, { ...BRIEF, budget_total_eur: 0 }).includes("budget_matches_items")
  );
}

section("grounding");
{
  const days = baseline();
  for (const day of days) for (const it of day.items) it.confidence_tier = "inferred";
  const report = assessQuality(itinerary(days), BRIEF, plan());
  check("grounded_ratio fires when nothing is backed by anything", report.findings.some((f) => f.check === "grounded_ratio"));
  check("groundedPercent is recorded", report.groundedPercent === 0, String(report.groundedPercent));

  const verified = baseline();
  for (const day of verified) {
    for (const it of day.items) it.google_maps_url = "https://maps.google.com/x";
  }
  const good = assessQuality(itinerary(verified), BRIEF, plan());
  check("a Places-confirmed trip reports 100%", good.groundedPercent === 100, String(good.groundedPercent));
}

section("a day with nothing in it, and hours nobody accounted for");
{
  // The Rome day 2: breakfast, lunch, one walk, dinner. It passed the old
  // one-activity bar while holding a five-hour void either side of lunch.
  const thin = baseline();
  thin[1].items = [
    meal("Breakfast", "Cafe X", "08:00"),
    meal("Lunch", "Trattoria X", "13:00"),
    item({ title: "Wander the old quarter", venue_name: null, time: "14:30", cost_estimate_eur: 0 }),
    meal("Dinner", "Osteria X", "20:00"),
    lodging("Hotel Real"),
  ];
  const fired = firedChecks(thin);
  check("a full day with one activity is now a defect", fired.includes("day_not_empty"));
  const report = assessQuality(itinerary(thin), BRIEF, plan());
  check(
    "the gap check names the hours",
    report.findings.some((f) => f.check === "day_has_gap" && f.detail.includes("8:00")),
    report.findings.filter((f) => f.check === "day_has_gap").map((f) => f.detail).join("; ")
  );
  check("gaps are warnings, not defects", report.findings.find((f) => f.check === "day_has_gap")?.severity === "warning");

  // Written downtime closes the gap — the point is that the time is
  // accounted for, not that it is filled with activity.
  const withDowntime = baseline();
  withDowntime[1].items = [
    meal("Breakfast", "Cafe Y", "08:00"),
    item({ title: "Slow morning at the market", venue_name: "Mercato Y", time: "10:30" }),
    meal("Lunch", "Trattoria Y", "13:00"),
    item({ title: "Afternoon at leisure near the hotel", venue_name: null, time: "15:30", cost_estimate_eur: 0 }),
    item({ title: "Sunset walk by the river", venue_name: null, time: "18:00", cost_estimate_eur: 0 }),
    meal("Dinner", "Osteria Y", "20:00"),
    lodging("Hotel Real"),
  ];
  check("written downtime is not a gap", !firedChecks(withDowntime).includes("day_has_gap"));
  check("and that day has enough in it", !firedChecks(withDowntime).includes("day_not_empty"));

  // An arrival day is allowed to be lighter — the flight takes the rest.
  check("the arrival day is not held to the full-day bar", !firedChecks(baseline()).includes("day_not_empty"));

  // A quiet evening after dinner is an evening, not a hole.
  const quietEvening = baseline();
  quietEvening[1].items.push(item({ title: "Late drink", venue_name: "Bar Z", time: "23:00" }));
  check(
    "a gap that starts after the day is over does not fire",
    !firedChecks(quietEvening).some((c) => c === "day_has_gap")
  );
}

section("a flight is not a complete arrival");
{
  const days = baseline();
  days[0].items = days[0].items.filter((i) => i.type !== "transport" || i.is_flight === true);
  const report = assessQuality(itinerary(days), BRIEF, plan());
  const finding = report.findings.find((f) => f.check === "transport_legs");
  check("transport_legs fires on a flight with no ground leg", !!finding);
  check("names the day", finding?.detail === "day 1 has a flight but no way to or from the airport", finding?.detail);
  check("a warning — some cities have one obvious link", finding?.severity === "warning");
  check("and the baseline, which has the transfer, does not fire", !firedChecks(baseline()).includes("transport_legs"));
}

section("meal prices against Google's price tier");
{
  const days = baseline();
  const dinner = days[0].items.find((i) => i.type === "meal" && i.time === "19:30") as ItineraryItem;
  dinner.google_price_level = "very_expensive";
  dinner.cost_estimate_eur = 40; // for two — EUR 20 each at a very expensive venue
  const fired = firedChecks(days);
  check("price_matches_tier fires on a clear understatement", fired.includes("price_matches_tier"));
  check(
    "it is a warning, not a defect — a cheap lunch at a pricey place is real",
    assessQuality(itinerary(days), BRIEF, plan()).findings.find((f) => f.check === "price_matches_tier")?.severity === "warning"
  );

  const plausible = baseline();
  const d2 = plausible[0].items.find((i) => i.type === "meal" && i.time === "19:30") as ItineraryItem;
  d2.google_price_level = "very_expensive";
  d2.cost_estimate_eur = 120; // EUR 60 each — consistent with the tier
  check("a consistent price does not fire", !firedChecks(plausible).includes("price_matches_tier"));

  const noTier = baseline();
  check("no tier from Google means nothing to check", !firedChecks(noTier).includes("price_matches_tier"));
}

section("accommodation priced per night, not per stay");
{
  // The Rome trip: a two-night stay at EUR 132/night written as EUR 264 on
  // BOTH nights, which doubles the largest line in the trip and quietly
  // inflates a total the traveler is budgeting against.
  const rate: SkeletonAccommodation[] = [
    { city: "Ubud", name: "Hotel Real", area: "Centre", cost_per_night_eur: 132, source_confidence: "grounded", source_urls: ["u"] },
  ];
  const days = baseline();
  for (const d of days) for (const it of d.items) if (it.type === "lodging") it.cost_estimate_eur = 264;

  const before = assessQuality(itinerary(days), BRIEF, plan(), rate);
  check("the gate catches a whole-stay price", before.findings.some((f) => f.check === "lodging_price_per_night"));
  check("and calls it a defect", before.findings.find((f) => f.check === "lodging_price_per_night")?.severity === "defect");

  const corrected = normalizeLodgingPrices(itinerary(days), rate);
  check("every wrong night is corrected", corrected === 2, `${corrected} corrected`);
  check(
    "to the rate that was actually looked up",
    days.every((d) => d.items.every((it) => it.type !== "lodging" || it.cost_estimate_eur === 132))
  );
  check("and the gate then passes it", !firedChecksWith(days, rate).includes("lodging_price_per_night"));

  // Rounding and a city tax are legitimate; only a multiple is not.
  const nudged = baseline();
  for (const d of nudged) for (const it of d.items) if (it.type === "lodging") it.cost_estimate_eur = 145;
  check(
    "a small variance is left alone (rounding, city tax)",
    normalizeLodgingPrices(itinerary(nudged), rate) === 0
  );
  check(
    "with no rate to compare against, nothing is touched",
    normalizeLodgingPrices(itinerary(baseline()), []) === 0
  );
}

section("what actually moves the verified percentage");
{
  // The Bali trip read 19% and it was fully explained by three groups of
  // items that CANNOT be grounded, not by verification failing. Each is
  // pinned here so the arithmetic is inspectable instead of argued about.

  // Start from a trip where NOTHING is grounded, so each piece of evidence
  // added below is actually what moves the number.
  const verified = baseline();
  for (const d of verified) for (const it of d.items) it.confidence_tier = "inferred";
  const bare = assessQuality(itinerary(verified), BRIEF, plan());
  check("with no evidence at all, 0%", bare.groundedPercent === 0, `${bare.groundedPercent}%`);

  // 1. A Places-confirmed venue counts. This is the bulk of a good trip.
  for (const d of verified) {
    for (const it of d.items) {
      if (it.type === "meal" || it.type === "activity") it.google_maps_url = "https://maps.google.com/x";
    }
  }
  const venuesOnly = assessQuality(itinerary(verified), BRIEF, plan());
  check(
    "Places-confirmed venues alone do not reach 100% — flights and beds are still unbacked",
    venuesOnly.groundedPercent > 0 && venuesOnly.groundedPercent < 100,
    `${venuesOnly.groundedPercent}%`
  );

  // 2. A flight with a real Google Flights link counts — the scoring bug.
  //    Flights are deliberately never web-searched BECAUSE the link is the
  //    verification mechanism, and the score used to ignore it entirely.
  const flight = verified[0].items.find((i) => i.is_flight);
  if (flight) flight.flight_search_url = "https://google.com/travel/flights?x";
  const withFlight = assessQuality(itinerary(verified), BRIEF, plan());
  check(
    "a checkable Google Flights link now counts as evidence",
    withFlight.groundedPercent > venuesOnly.groundedPercent,
    `${venuesOnly.groundedPercent}% -> ${withFlight.groundedPercent}%`
  );
  // 3. Grounded lodging and transport count via source_urls rather than
  //    Places. A ground transfer is the one item type with no automatic
  //    verification path — no Places entry, no flight link — so including
  //    one here proves the score has no structural ceiling rather than
  //    quietly capping at whatever fraction happens to be verifiable.
  for (const d of verified) {
    for (const it of d.items) {
      if (it.type === "transport" && it.is_flight !== true) {
        it.source_confidence = "grounded";
        it.source_urls = ["https://example.com/transfer"];
        it.confidence_tier = "single_source";
        continue;
      }
      if (it.type !== "lodging") continue;
      it.source_confidence = "grounded";
      it.source_urls = ["https://example.com/rate"];
      it.confidence_tier = "single_source";
    }
  }
  const full = assessQuality(itinerary(verified), BRIEF, plan());
  check(
    "a fully-verified trip reads 100%, not capped below it",
    full.groundedPercent === 100,
    `${full.groundedPercent}%`
  );
  check("and raises no grounding warning", !full.findings.some((f) => f.check === "grounded_ratio"));

  // The realistic failure that actually produced 19%: generic accommodation
  // on every night. On a long trip that alone is a large share of the items.
  const genericLodging = baseline();
  for (const d of genericLodging) {
    for (const it of d.items) {
      if (it.type === "meal" || it.type === "activity") it.google_maps_url = "https://maps.google.com/x";
      if (it.type === "lodging") {
        it.venue_name = null;
        it.source_confidence = "inferred";
        it.confidence_tier = "inferred";
      }
    }
  }
  const g = assessQuality(itinerary(genericLodging), BRIEF, plan());
  check(
    "unverified accommodation is the single biggest drag on the number",
    g.groundedPercent < full.groundedPercent,
    `${g.groundedPercent}% vs ${full.groundedPercent}%`
  );
}

section("a lost plan is reported, not silently skipped");
{
  // The single-call fallback produces no day plan. The meal check cannot
  // run without one — but the run must not therefore look clean.
  const report = assessQuality(itinerary(baseline()), BRIEF, []);
  check("still returns a report", report.itemCount > 0);
  check(
    "meal check simply does not fire rather than passing falsely",
    !report.findings.some((f) => f.check === "meals_present")
  );
}

finish();
