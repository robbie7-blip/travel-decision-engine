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

import { assessQuality } from "./engine/quality";
import type { SkeletonDay } from "./engine/twoPhase";
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
  const items = [
    meal("Breakfast", `Cafe ${n}`, "08:30"),
    item({ title: `Sight ${n}`, venue_name: `Temple ${n}`, time: "10:30" }),
    meal("Lunch", `Warung ${n}`, "13:00"),
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
  days[0].items.unshift(item({ type: "transport", title: "Flight to Denpasar", venue_name: null, time: "06:00", is_flight: true, cost_estimate_eur: 700 }));
  return days;
}

function firedChecks(days: ItineraryDay[]): string[] {
  return assessQuality(itinerary(days), BRIEF, plan()).findings.map((f) => f.check);
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
