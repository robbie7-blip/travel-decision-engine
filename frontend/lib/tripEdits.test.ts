// Run: npm run test:trip-edits

import assert from "node:assert/strict";
import { applyTripEdits, parseTripEdits } from "./tripEdits";
import type { Itinerary } from "./types";

const item = (time: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ time, title, type: "activity", location: "x", cost_estimate_eur: 0, reasoning: "", ...extra }) as never;

const trip = (): Itinerary =>
  ({
    trip_summary: "s",
    key_decisions: [],
    things_to_skip: [],
    budget_feasibility: {},
    pushback_response: "earlier answer",
    days: [
      { day: 1, date: "2026-11-06", items: [item("09:00", "A"), item("13:00", "B", { google_open_on_visit: true, google_maps_url: "m" }), item("19:00", "C")] },
      { day: 2, date: "2026-11-07", items: [item("10:00", "D"), item("20:00", "E")] },
    ],
  }) as never;

const titles = (it: Itinerary) => it.days.map((d) => d.items.map((i) => `${i.time} ${i.title}`).join(", ")).join(" | ");

// Parsing: strict, and times normalised.
assert.equal(parseTripEdits([]).ok, false);
assert.equal(parseTripEdits("x").ok, false);
assert.equal(parseTripEdits([{ day: 1, index: 0 }]).ok, false, "an edit that changes nothing");
assert.equal(parseTripEdits([{ day: 1, index: 0, time: "25:00" }]).ok, false);
assert.equal(parseTripEdits([{ day: 1, index: 0, time: "9:5" }]).ok, false);
assert.equal(parseTripEdits([{ day: 1, index: 0, remove: "yes" }]).ok, false);
const parsed = parseTripEdits([{ day: 1, index: 0, time: "9:30" }]);
assert.ok(parsed.ok && parsed.edits[0].time === "09:30");
assert.equal(parseTripEdits(Array.from({ length: 201 }, () => ({ day: 1, index: 0, remove: true }))).ok, false);

// Applying: positions are the ORIGINAL ones, whatever order edits come in.
{
  const base = trip();
  const r = applyTripEdits(base, [
    { day: 1, index: 2, toDay: 2 }, // C to day 2
    { day: 1, index: 0, remove: true }, // A gone
    { day: 2, index: 1, time: "08:00" }, // E early
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(titles(r.itinerary), "13:00 B | 08:00 E, 10:00 D, 19:00 C");
    assert.equal(r.changed, 3);
    assert.equal(r.itinerary.pushback_response, undefined, "the old answer is about the old trip");
  }
  assert.equal(titles(base), "09:00 A, 13:00 B, 19:00 C | 10:00 D, 20:00 E", "the original is untouched");
}

// Moving a line drops the opening-hours claim, keeps the place's own facts.
{
  const r = applyTripEdits(trip(), [{ day: 1, index: 1, toDay: 2 }]);
  assert.ok(r.ok);
  if (r.ok) {
    const b = r.itinerary.days[1].items.find((i) => i.title === "B")!;
    assert.equal(b.google_open_on_visit, undefined);
    assert.equal(b.google_maps_url, "m");
  }
  const same = applyTripEdits(trip(), [{ day: 1, index: 1, time: "14:00" }]);
  assert.ok(same.ok && same.itinerary.days[0].items[1].google_open_on_visit === true, "a time change on the same day keeps it");
}

// Stale or contradictory edits are refused whole.
assert.equal(applyTripEdits(trip(), [{ day: 1, index: 3, remove: true }]).ok, false);
assert.equal(applyTripEdits(trip(), [{ day: 3, index: 0, remove: true }]).ok, false);
assert.equal(applyTripEdits(trip(), [{ day: 1, index: 0, toDay: 9 }]).ok, false);
assert.equal(applyTripEdits(trip(), [{ day: 1, index: 0, remove: true }, { day: 1, index: 0, time: "10:00" }]).ok, false);

// "morning" and friends sort where they fall, not at the end.
{
  const t = trip();
  t.days[1].items.push(item("morning", "M"));
  const r = applyTripEdits(t, [{ day: 2, index: 0, time: "11:00" }]);
  assert.ok(r.ok && r.itinerary.days[1].items.map((i) => i.title).join("") === "MDE", r.ok ? titles(r.itinerary) : "");
}

console.log("tripEdits: all assertions passed");
