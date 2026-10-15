// Run: npm run test:spending

import assert from "node:assert/strict";
import { readSpendMap, spendingCurrency, spendingSummary, spendRef, toEur } from "./spending";

const rates = { base: "EUR" as const, rates: { BGN: 1.9558, USD: 1.1 }, fetchedAt: 1 };

assert.equal(spendRef(2, 0), "d2.1");
assert.deepEqual(readSpendMap({ "d1.1": 12, "d1.2": -3, "d1.3": "4", "x": 5, "d2.1": Infinity }), { "d1.1": 12 });
assert.deepEqual(readSpendMap(["d1.1"]), {});
assert.deepEqual(readSpendMap(null), {});

assert.equal(toEur("19.56", "BGN", rates), 10, "typed in leva, stored in euros");
assert.equal(toEur("19,56", "BGN", rates), 10, "a comma works as the decimal point");
assert.equal(toEur("12", "EUR", rates), 12);
assert.equal(toEur("12", "GBP", rates), 12, "no live rate: taken as EUR, never guessed");
assert.equal(spendingCurrency("GBP", rates), "EUR", "and the input says so");
assert.equal(spendingCurrency("BGN", rates), "BGN");
assert.equal(toEur("", "EUR", rates), null);
assert.equal(toEur("abc", "EUR", rates), null);
assert.equal(toEur("-5", "EUR", rates), null);

const item = (type: string, cost: unknown) => ({ time: "10:00", type, title: "x", location: "", cost_estimate_eur: cost, reasoning: "" }) as never;
const days = [
  { day: 1, date: "2026-11-06", items: [item("meal", 30), item("activity", 0), item("meal", "15-20")] },
  { day: 2, date: "2026-11-07", items: [item("lodging", 120)] },
] as never;
const s = spendingSummary(days, { "d1.1": 42, "d1.3": 18 });
assert.equal(s.plannedEur, 150, "unpriced lines are not counted as free");
assert.equal(s.spentEur, 60);
assert.equal(s.tracked, 2);
assert.equal(s.plannedForTrackedEur, 30, "the unreadable price adds nothing to the comparison");

console.log("spending: all assertions passed");
