// Run: npm run test:last-search

import assert from "node:assert/strict";
import { restoreLastSearch, serializeLastSearch } from "./lastSearch";

const TODAY = "2026-10-14";
const saved = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    destinations: "Lisbon, Porto",
    start_date: "2026-11-10",
    end_date: "2026-11-14",
    party_size: "4",
    party_composition: "family with children",
    ...over,
  });

// The round trip.
assert.deepEqual(restoreLastSearch(saved(), TODAY), {
  destinations: "Lisbon, Porto",
  start_date: "2026-11-10",
  end_date: "2026-11-14",
  party_size: "4",
  party_composition: "family with children",
});

// Only the bar's four answers are written, whatever else the form held.
const written = JSON.parse(
  serializeLastSearch({
    destinations: "Rome",
    start_date: "2026-11-01",
    end_date: "2026-11-03",
    party_size: "2",
    party_composition: "couple",
    budget_total_eur: "900",
    dietary_constraints: "coeliac",
  } as never)
);
assert.deepEqual(Object.keys(written).sort(), ["destinations", "end_date", "party_composition", "party_size", "start_date"]);

// Dates already started are dropped; cities and party stay.
assert.deepEqual(restoreLastSearch(saved({ start_date: "2026-10-01", end_date: "2026-10-20" }), TODAY), {
  destinations: "Lisbon, Porto",
  party_size: "4",
  party_composition: "family with children",
});
// A trip starting today is still plannable.
assert.equal(restoreLastSearch(saved({ start_date: TODAY, end_date: "2026-10-16" }), TODAY)?.start_date, TODAY);
// Reversed or malformed dates are dropped.
assert.equal(restoreLastSearch(saved({ start_date: "2026-11-14", end_date: "2026-11-10" }), TODAY)?.start_date, undefined);
assert.equal(restoreLastSearch(saved({ start_date: "14/11/2026" }), TODAY)?.start_date, undefined);

// A party without both halves is dropped as a pair.
assert.equal(restoreLastSearch(saved({ party_composition: "" }), TODAY)?.party_size, undefined);
assert.equal(restoreLastSearch(saved({ party_size: "0" }), TODAY)?.party_size, undefined);
assert.equal(restoreLastSearch(saved({ party_size: 4 }), TODAY)?.party_size, undefined);

// Nothing usable is null, never a throw.
assert.equal(restoreLastSearch(null, TODAY), null);
assert.equal(restoreLastSearch("", TODAY), null);
assert.equal(restoreLastSearch("{not json", TODAY), null);
assert.equal(restoreLastSearch("null", TODAY), null);
assert.equal(restoreLastSearch(saved({ destinations: "   " }), TODAY), null);
assert.equal(restoreLastSearch(saved({ destinations: "x".repeat(501) }), TODAY), null);

console.log("lastSearch: all assertions passed");
