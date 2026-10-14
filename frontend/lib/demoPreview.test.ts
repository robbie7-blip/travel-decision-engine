// Run: npm run test:demo-preview

import assert from "node:assert/strict";
import { demoPreviewOf } from "./demoPreview";
import type { Itinerary, ItineraryItem } from "./types";

const item = (time: string, title: string, tier?: ItineraryItem["confidence_tier"], extra: Partial<ItineraryItem> = {}) =>
  ({ time, title, confidence_tier: tier, ...extra }) as ItineraryItem;

const trip = (days: ItineraryItem[][]): Itinerary =>
  ({
    trip_summary: "",
    key_decisions: [],
    things_to_skip: [],
    budget_feasibility: {},
    days: days.map((items, i) => ({ day: i + 1, date: `2026-11-${String(10 + i).padStart(2, "0")}`, items, feasibility_flag: null })),
  }) as unknown as Itinerary;

// Nothing to show is null, not an empty card.
assert.equal(demoPreviewOf(null), null);
assert.equal(demoPreviewOf(trip([])), null);
assert.equal(demoPreviewOf(trip([[]])), null);

// Day 1 is an arrival with one tier; day 2 shows three. Day 2 wins.
const p = demoPreviewOf(
  trip([
    [item("15:00", "Land and check in", "verified"), item("19:00", "Dinner", "verified")],
    [
      item("09:00", "Tram 28", "verified"),
      item("11:00", "Castle", "single_source"),
      item("13:00", "Lunch", "inferred"),
      item("15:00", "Museum", "verified"),
      item("18:00", "Fifth line, not shown", "verified"),
    ],
    [item("10:00", "Beach", "inferred")],
  ])
);
assert.ok(p);
assert.equal(p.day, 2);
assert.equal(p.dayDate, "2026-11-11");
assert.equal(p.days, 3);
assert.equal(p.startDate, "2026-11-10");
assert.equal(p.endDate, "2026-11-12");
assert.deepEqual(
  p.lines.map((l) => `${l.time} ${l.title} ${l.tier}`),
  ["09:00 Tram 28 verified", "11:00 Castle single_source", "13:00 Lunch inferred", "15:00 Museum verified"]
);

// Flights are skipped (the line is a route, not a plan), a missing tier is
// shown as what the trip page shows - an honest guess - and long titles
// are cut with an ellipsis rather than overflowing the card.
const long = "A".repeat(120);
const q = demoPreviewOf(trip([[item("07:00", "SOF to LIS", "verified", { is_flight: true }), item("12:00", long), item("", "No time")]]));
assert.ok(q);
assert.equal(q.lines.length, 2);
assert.equal(q.lines[0].tier, "inferred");
assert.equal(q.lines[0].title.length, 90);
assert.ok(q.lines[0].title.endsWith("…"));
assert.equal(q.lines[1].time, "");

// Nothing from the brief can be in it: the input has no brief, and the
// output's keys are exactly these.
assert.deepEqual(Object.keys(p).sort(), ["day", "dayDate", "days", "endDate", "lines", "startDate", "trustPercent"]);

console.log("demoPreview: all assertions passed");
