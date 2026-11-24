// The dates a traveller chose for each place, held in the plan.
//
// Run: npm run test:city-dates

import assert from "node:assert/strict";
import { cityOnDate } from "./engine/cityDates";
import { normalizePlan } from "./engine/twoPhase";
import { buildPrompt } from "./engine/prompt";
import { checkBrief } from "./briefShape";

const stays = [
  { city: "Rome", start_date: "2027-05-01", end_date: "2027-05-04" },
  { city: "Florence", start_date: "2027-05-04", end_date: "2027-05-07" },
];

assert.equal(cityOnDate(stays, "2027-05-03"), "Rome");
assert.equal(cityOnDate(stays, "2027-05-04"), "Florence", "the travel day is where they arrive");
assert.equal(cityOnDate(undefined, "2027-05-04"), null);

// The model put the whole trip in Rome; the chosen dates win.
const plan = {
  days: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ day: n, date: `2027-05-0${n}`, city: "Rome", theme: "t", include_lodging: n < 7, anchors: [], meals: ["lunch"] })),
};
normalizePlan(plan, { destinations: ["Rome", "Florence"], start_date: "2027-05-01", needs_lodging: true, city_dates: stays });
assert.deepEqual(plan.days.map((d) => d.city), ["Rome", "Rome", "Rome", "Florence", "Florence", "Florence", "Florence"]);

// Without chosen dates, the model's split stands.
const free = { days: [{ day: 1, date: "2027-05-01", city: "Florence", theme: "t", include_lodging: true, anchors: [], meals: ["lunch"] }] };
normalizePlan(free, { destinations: ["Rome", "Florence"], start_date: "2027-05-01", needs_lodging: true });
assert.equal(free.days[0].city, "Florence");

// The prompt says so, in words the model can follow.
const brief = {
  destinations: ["Rome", "Florence"], start_date: "2027-05-01", end_date: "2027-05-07", party_size: 2, party_composition: "couple",
  budget_total_eur: 2000, pace: "moderate" as const, interests: [], must_see: [], dietary_constraints: [], mobility_constraints: [], hard_no: [],
  language: "en" as const, needs_lodging: true, needs_flight: true, city_dates: stays,
};
const block = buildPrompt(brief);
assert.ok(block.includes("Rome from 2027-05-01 to 2027-05-04; Florence from 2027-05-04 to 2027-05-07"), block);
assert.ok(!buildPrompt({ ...brief, city_dates: undefined }).includes("Where each day is"));

// The worker keeps well-formed dates and drops anything else.
const shaped = checkBrief({ ...brief });
assert.ok(shaped.ok && shaped.brief.city_dates?.length === 2);
const junk = checkBrief({ ...brief, city_dates: "Rome then Florence" });
assert.ok(junk.ok && junk.brief.city_dates === undefined && junk.repaired.includes("city_dates"));

console.log("city dates: all assertions passed");
