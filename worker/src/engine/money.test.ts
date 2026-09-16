// What counts as a price, and what a price that isn't one used to do.
//
// The gap this closes was found by asking the plainest possible question of
// the pipeline: types.ts declares `cost_estimate_eur: number`, and who ever
// checked? The answer was nobody - the value arrives through `JSON.parse(text)
// as ItineraryDay`, which is an assertion, and between there and the trip
// total there was no test of any kind on the type of a price.
//
// The section named "what one mistyped price did" is the point of this file.
// It runs the old arithmetic beside the new, because the failure is entirely
// invisible from the type system's side and looks like nothing on the page:
// the ITEM renders perfectly ("€20", because Math.round("20") is 20) while the
// total silently becomes 102030.
//
// Run: npm run test:money

import { costForSum, itemPriceEur, mustCost, parseCurrencyNumber, usableCostEur } from "./money";
import { check, finish, heading, section } from "../testutil";
import type { ItineraryItem } from "../types";

heading("what counts as a price");

const item = (over: Partial<ItineraryItem>): ItineraryItem => ({
  time: "13:00",
  type: "meal",
  title: "Lunch at Roscioli",
  location: "Centro Storico, Rome",
  cost_estimate_eur: 28,
  reasoning: "r",
  source_confidence: "inferred",
  ...over,
});

function main() {
  {
    section("a number that is a price");

    check("a plain number", usableCostEur(28) === 28);
    check("a decimal", usableCostEur(12.5) === 12.5);
    // Zero passes HERE on purpose. It is a real price for a free museum, and
    // deciding it is wrong for a dinner is mustCost's job, not this one -
    // conflating the two is what made the page print "Free" for a dinner.
    check("zero, which is a real price for a walk", usableCostEur(0) === 0);
    check("a large but finite number is the model's claim, not an error", usableCostEur(250_000) === 250_000);
  }

  {
    section("a number that is not");

    // Negative subtracts from the trip total, which no line item may do.
    check("negative", usableCostEur(-5) === null);
    check("NaN", usableCostEur(Number.NaN) === null);
    check("Infinity", usableCostEur(Number.POSITIVE_INFINITY) === null);
    check("null", usableCostEur(null) === null);
    check("undefined", usableCostEur(undefined) === null);
    check("an object", usableCostEur({ eur: 20 }) === null);
    check("an array", usableCostEur([20]) === null);
    check("a boolean", usableCostEur(true) === null);
    // Number("") and Number(" ") are both 0, which is why the string reader
    // requires a pattern rather than trusting Number() to refuse.
    check("an empty string", usableCostEur("") === null);
    check("whitespace", usableCostEur("   ") === null);
  }

  {
    section("a price the model typed as text");

    // Recovered, because the value is real and only the type is wrong.
    check('"20"', usableCostEur("20") === 20);
    check('" 20 "', usableCostEur(" 20 ") === 20);
    check('"20.50"', usableCostEur("20.50") === 20.5);
    check('"EUR 140"', usableCostEur("EUR 140") === 140);
    check('"€140"', usableCostEur("€140") === 140);
    check('"1,200"', usableCostEur("1,200") === 1200);

    // REFUSED, because picking an end of a range or a number out of a
    // sentence is inventing a price rather than reading one. This is the
    // same line lodgingCache drew for a nightly rate, and it is why that
    // file's reader now lives here.
    check('"15-20" - a range', usableCostEur("15-20") === null);
    check('"120 - 160"', usableCostEur("120 - 160") === null);
    check('"about 20"', usableCostEur("about 20") === null);
    check('"20 per person"', usableCostEur("20 per person") === null);
    check('"twenty"', usableCostEur("twenty") === null);
    check('"free"', usableCostEur("free") === null);
    check('"1,2" - not a thousands separator', usableCostEur("1,2") === null);
    check('"-20" as text', usableCostEur("-20") === null);

    // The primitive itself, since lodgingCache depends on this exact
    // behaviour and its own suite is the other thing asserting it.
    check("parseCurrencyNumber returns NaN for a range", Number.isNaN(parseCurrencyNumber("15-20")));
    check("  and the number for a clean one", parseCurrencyNumber(" £1,450 ") === 1450);
  }

  {
    section("what one mistyped price did");

    // THE measurement. One item priced "20" instead of 20, three items, and
    // the two ways of adding them up side by side.
    const prices: unknown[] = [10, "20", 30];

    // The old arithmetic, verbatim: `sum + (i.cost_estimate_eur || 0)`.
    const before = prices.reduce<unknown>((sum, p) => (sum as number) + ((p as number) || 0), 0);
    check("the old sum is a STRING, not a number", typeof before === "string", JSON.stringify(before));
    check('  and it reads "102030"', before === "102030", JSON.stringify(before));
    // Which is what reached the budget comparison and the compare table.
    check(
      "  so the trip total was reported as 102030",
      Math.round(before as unknown as number) === 102030,
      String(Math.round(before as unknown as number))
    );

    const after = prices.reduce<number>((sum, p) => sum + costForSum(p), 0);
    check("the new sum is a number", typeof after === "number");
    check("  and it is 60", after === 60, String(after));

    // A range poisons the old sum differently - into NaN, which printed as
    // "EUR NaN against a EUR 2000 budget".
    const ranged: unknown[] = [10, "15-20", 30];
    const beforeRanged = ranged.reduce<unknown>((sum, p) => (sum as number) + ((p as number) || 0), 0);
    check("a range made the old total NaN", Number.isNaN(Math.round(beforeRanged as unknown as number)), JSON.stringify(beforeRanged));
    check("  and the new total is just the readable prices", ranged.reduce<number>((s, p) => s + costForSum(p), 0) === 40);

    // An unreadable price can only ever make the total an UNDER-estimate,
    // which is what makes counting it as nothing safe: budget_matches_items
    // fires only when the total is OVER the stated budget, so a missing
    // price cannot manufacture that defect. A string price could, and did.
    check("an unreadable price counts as nothing", costForSum("15-20") === 0);
    check("  and a readable one counts fully", costForSum("30") === 30);
    check("  and a real zero counts as zero", costForSum(0) === 0);
  }

  {
    section("zero: free, or no price at all");

    check("a meal must cost something", mustCost(item({ type: "meal" })));
    check("a bed must too", mustCost(item({ type: "lodging" })));
    check("and a flight", mustCost(item({ type: "transport", is_flight: true })));
    check("an activity need not - a park is free", mustCost(item({ type: "activity" })) === false);
    check("nor need ground transport", mustCost(item({ type: "transport" })) === false);
    check("  including one that says so explicitly", mustCost(item({ type: "transport", is_flight: false })) === false);

    // The page printed "Free" for every zero, including the three above -
    // telling a traveler a restaurant dinner cost nothing, which is the one
    // kind of claim this product is most careful about elsewhere.
    check("a free activity keeps its real zero", itemPriceEur(item({ type: "activity", cost_estimate_eur: 0 })) === 0);
    check(
      "a dinner priced zero has NO figure, rather than being free",
      Number.isNaN(itemPriceEur(item({ type: "meal", cost_estimate_eur: 0 })))
    );
    check(
      "  same for a bed",
      Number.isNaN(itemPriceEur(item({ type: "lodging", cost_estimate_eur: 0 })))
    );
    check(
      "  same for a flight",
      Number.isNaN(itemPriceEur(item({ type: "transport", is_flight: true, cost_estimate_eur: 0 })))
    );
    check("a real price passes straight through", itemPriceEur(item({ cost_estimate_eur: 28 })) === 28);
    check(
      "  a text price is recovered",
      itemPriceEur(item({ cost_estimate_eur: "28" as unknown as number })) === 28
    );
    check(
      "  and an unreadable one has no figure",
      Number.isNaN(itemPriceEur(item({ cost_estimate_eur: "15-20" as unknown as number })))
    );
  }

  finish();
}

main();
