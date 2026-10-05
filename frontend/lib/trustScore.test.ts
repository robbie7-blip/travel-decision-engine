// The number on the front of every itinerary, which had no test.
//
// computeTrustScore produces the "N% verified" figure the traveller reads
// before anything else on the page, and until this file existed nothing
// asserted what it counts. It is also duplicated on purpose: the worker
// records the same figure through groundedRatio (worker/src/engine/
// quality.ts), and that file's own comment says the two are "kept
// identical on purpose - two definitions of verified would be worse than
// none". A duplicated formula with a test on neither side is how they
// drift, and the symptom would be the page and the quality report
// disagreeing about the same trip with nothing pointing at why.
//
// So this states the contract: FOUR independent signals, any one of which
// makes a line count.
//
//   confidence_tier    anything but "inferred" - the model's own sourcing
//   google_maps_url    a Places match: this business is real and is here
//   flight_search_url  a real route/date link, built not guessed
//   directions_url     the same, for a ground leg with no venue to look up
//
// The last one is the newest and the reason this file was written now. A
// metro ride, a taxi and a walk between two areas have no business for
// Places to confirm, so every one of them counted against the score
// however checkable it was - on a real trip the owner was unhappy with,
// that was a visible slice of a 47% figure.
//
// Pure arithmetic over an object, no network.

import { computeTrustScore } from "./trustScore";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryDay, ItineraryItem } from "./types";

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    time: "10:00",
    type: "activity",
    title: "Something",
    venue_name: "Some Place",
    location: "Rome",
    cost_estimate_eur: 10,
    reasoning: "r",
    source_confidence: "inferred",
    confidence_tier: "inferred",
    ...over,
  };
}

function trip(items: ItineraryItem[]): Itinerary {
  const day: ItineraryDay = { day: 1, date: "2027-03-18", items, feasibility_flag: null };
  return {
    budget_feasibility: { feasible: true, min_realistic_total_eur: 600, reasoning: "r" },
    trip_summary: "s",
    key_decisions: [],
    days: [day],
    things_to_skip: [],
  };
}

function main() {
  heading("THE VERIFIED PERCENTAGE - what actually counts");

  section("each signal on its own is enough");
  {
    // One ungrounded item beside one grounded one, so the percentage says
    // which of the two counted rather than reading 100% either way.
    const withSignal = (over: Partial<ItineraryItem>): number =>
      computeTrustScore(trip([item(), item(over)])).percent;

    check("a tier above inferred counts", withSignal({ confidence_tier: "fact_grounded" }) === 50);
    check("a Places match counts", withSignal({ google_maps_url: "https://maps.example/x" }) === 50);
    check("a rating alone counts", withSignal({ google_rating: 4.5 }) === 50);
    check("a flight link counts", withSignal({ flight_search_url: "https://flights.example/x" }) === 50);
    // The one this file was written for.
    check(
      "and a ground leg's directions link counts",
      withSignal({ type: "transport", directions_url: "https://maps.example/dir" }) === 50
    );
  }

  section("a line with nothing behind it does not count");
  {
    check("an inferred item with no links is not grounded", computeTrustScore(trip([item()])).percent === 0);
    check(
      "and a transport leg with no link is not grounded either",
      computeTrustScore(trip([item({ type: "transport", venue_name: null })])).percent === 0
    );
    // The exact failure the directions link fixes: a day whose legs are
    // perfectly checkable but have no venue to look up.
    const legsOnly = trip([
      item({ google_maps_url: "https://maps.example/a" }),
      item({ type: "transport", venue_name: null }),
      item({ google_maps_url: "https://maps.example/b" }),
      item({ type: "transport", venue_name: null }),
    ]);
    check("two venues and two bare legs scores 50%", computeTrustScore(legsOnly).percent === 50);
    for (const i of legsOnly.days[0].items) {
      if (i.type === "transport") i.directions_url = "https://maps.example/dir";
    }
    check("the same day with routed legs scores 100%", computeTrustScore(legsOnly).percent === 100);
  }

  section("the counts behind the percentage");
  {
    const score = computeTrustScore(
      trip([item({ google_maps_url: "https://maps.example/a" }), item(), item()])
    );
    check("totalCount is every line", score.totalCount === 3, String(score.totalCount));
    check("groundedCount is only the backed ones", score.groundedCount === 1, String(score.groundedCount));
    check("and the percentage is rounded", score.percent === 33, String(score.percent));
  }

  section("nothing to doubt");
  {
    // Deliberate: an empty itinerary is 100%, not 0%. There is no unbacked
    // claim in it, and showing a traveller "0% verified" for a trip with
    // no lines would be a scary number about nothing.
    check("an empty trip is 100%", computeTrustScore(trip([])).percent === 100);
    check("so is a trip with no days at all", computeTrustScore({ ...trip([]), days: [] }).percent === 100);
  }

  section("a day with no items array does not take the page down");
  {
    // `?? []` on day.items is load-bearing - this runs before a single row
    // is drawn, so a malformed day here is a blank trip page rather than a
    // missing line.
    const broken = { ...trip([item()]) } as Itinerary;
    (broken.days as unknown as { items?: ItineraryItem[] }[]).push({});
    let threw = false;
    try {
      computeTrustScore(broken);
    } catch {
      threw = true;
    }
    check("a day with no items is survived", !threw);
  }

  finish();
}

main();
