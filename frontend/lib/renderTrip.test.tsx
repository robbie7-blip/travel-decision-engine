// Does the trip page actually RENDER?
//
// Every other suite here asserts about a function. This one asserts about
// the PAGE, because the failure this product has had twice is a render
// throw on a field nothing guarantees - and the blast radius is a blank
// page on an itinerary somebody paid for. lib/currency.ts's own header
// records one: "/api/rates cached a body with no `rates` key, JSON.stringify
// dropped the field, and every trip page render threw inside formatMoney -
// for every visitor, for twelve hours, on itineraries people had paid for."
//
// A unit assertion cannot catch that. formatMoney returning "-" for an
// unreadable figure is only useful if the component around it survives the
// same itinerary, and the only way to know is to render it.
//
// THE ITINERARY BELOW IS DELIBERATELY UNNORMALIZED, which is the worst real
// case rather than a hypothetical one: the worker coerces these fields at
// the shape gate now, and no worker change can reach a record already
// sitting in Redis. This is what an older build left behind.
//
// Measured, with today's render fixes reverted: the page still produced
// 27,939 characters - so it did not throw - but the output contained "EUR
// NaN", and "Free" appeared TWICE, the second being a dinner priced zero.
// That is the shape of the bug this suite exists for: not a crash, a
// confident wrong number on a page about money.
//
// Run: npm run test:render-trip

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItineraryResult } from "../components/ItineraryResult";
import { TRANSLATIONS } from "./i18n";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary } from "./types";

heading("the trip page, rendered");

const item = (over: Record<string, unknown>) => ({
  time: "13:00",
  type: "meal",
  title: "Lunch at Roscioli",
  location: "Centro, Rome",
  cost_estimate_eur: 28,
  reasoning: "Family-run, worth the queue.",
  source_confidence: "inferred",
  ...over,
});

const trip = (items: Record<string, unknown>[]): Itinerary =>
  ({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 1200, reasoning: "It works." },
    trip_summary: "Four days in Rome.",
    key_decisions: [],
    things_to_skip: [],
    days: [{ day: 1, date: "2027-05-01", feasibility_flag: null, items }],
  }) as unknown as Itinerary;

/** The page's HTML, or null if it threw.
 *
 * createElement rather than JSX in the props object only; the suite itself
 * is .tsx and compiles under tsconfig.render.json - see that file for why
 * the main config cannot be used here. */
function render(result: Itinerary): string | null {
  try {
    return renderToStaticMarkup(
      React.createElement(ItineraryResult, {
        result,
        jobId: "job-test",
        t: TRANSLATIONS.en,
        onRefine: () => {},
        destinations: ["Rome"],
        startDate: "2027-05-01",
        endDate: "2027-05-04",
        partyComposition: "two adults",
        interests: [],
      } as never)
    );
  } catch {
    return null;
  }
}

function main() {
  {
    section("a clean itinerary renders");

    const html = render(trip([item({}), item({ type: "activity", cost_estimate_eur: 0 })]));
    check("it renders at all", html !== null);
    check("  with the trip in it", html !== null && html.includes("Four days in Rome"), "");
    check("  and the venue", html !== null && html.includes("Roscioli"), "");
    check("  and the real price", html !== null && html.includes("28"), "");
    // The free activity says so; nothing else does.
    check("  and 'Free' exactly once", (html?.match(/Free/g) ?? []).length === 1, String((html?.match(/Free/g) ?? []).length));
  }

  {
    section("an UNNORMALIZED stored itinerary renders, and says nothing false");

    // Every shape today's guards are for, on one itinerary.
    const html = render(
      trip([
        item({ cost_estimate_eur: "15-20" }), // a range: unreadable
        item({ cost_estimate_eur: "20" }), // a real price typed as text
        item({ type: "meal", cost_estimate_eur: 0 }), // a dinner with no price
        item({ type: "activity", cost_estimate_eur: 0 }), // genuinely free
        item({ cost_estimate_eur: 1300, time: 1300 }), // a numeric time
        item({ source_urls: "https://www.booking.com/x.html" }), // source_urls as a string
        item({ source_urls: ["booking.com", "https://a.example/p"] }),
        item({ venue_name: ["A", "B"] }), // a shortlist where a name goes
        item({ title: undefined, location: undefined }),
        item({ cost_estimate_eur: null, reasoning: 42 }),
        item({ type: "lodging", cost_estimate_eur: 0, venue_name: "Hotel X" }),
        item({ type: "transport", is_flight: true, cost_estimate_eur: 0 }),
      ])
    );

    check("the page does not throw", html !== null);
    check("  and is a whole page, not a fragment", (html?.length ?? 0) > 10_000, String(html?.length));
    check("  with the itinerary still in it", html !== null && html.includes("Roscioli"), "");

    // THE assertions. Each of these strings in the output is a confident
    // wrong statement about somebody's money or plan.
    for (const forbidden of ["NaN", "undefined", "[object Object]", "Infinity"]) {
      check(`  the output contains no ${JSON.stringify(forbidden)}`, html !== null && !html.includes(forbidden), "");
    }

    // A meal, a bed and a flight priced zero are prices the app does not
    // have - not free things. Only the activity is free.
    const frees = (html?.match(/Free/g) ?? []).length;
    check("  'Free' appears once, for the one genuinely free item", frees === 1, `${frees} times`);

    // The recoverable price is recovered rather than dropped.
    check("  a price typed as \"20\" still shows", html !== null && html.includes("20"), "");
  }

  {
    section("the shapes that blanked a trip page before");

    // A rates object with no map - the twelve-hour outage in currency.ts's
    // header. formatMoney guards it; this is the page surviving it.
    const withBadRates = (() => {
      try {
        return renderToStaticMarkup(
          React.createElement(ItineraryResult, {
            result: trip([item({})]),
            jobId: "j",
            t: TRANSLATIONS.en,
            onRefine: () => {},
            destinations: ["Rome"],
            startDate: "2027-05-01",
            endDate: "2027-05-04",
            partyComposition: "two adults",
            interests: [],
            currency: "USD",
            rates: { base: "EUR", fetchedAt: 1 },
          } as never)
        );
      } catch {
        return null;
      }
    })();
    check("a rates object with no map does not blank the page", withBadRates !== null);
    check("  and falls back to the EUR figure", withBadRates !== null && withBadRates.includes("28"), "");

    // A day with no items array - the calendar-download failure, on the page.
    const noItems = render({
      budget_feasibility: { feasible: true, min_realistic_total_eur: 1200, reasoning: "r" },
      trip_summary: "s",
      key_decisions: [],
      things_to_skip: [],
      days: [{ day: 1, date: "2027-05-01", feasibility_flag: null }],
    } as unknown as Itinerary);
    check("a day with no items array does not blank the page", noItems !== null);

    // No days at all.
    check("no days array does not blank the page", render({ budget_feasibility: {}, trip_summary: "s" } as unknown as Itinerary) !== null);
  }

  finish();
}

main();
