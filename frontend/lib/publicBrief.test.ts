// What a shared trip link may disclose.
//
// /api/job/[id] is public and unauthenticated, and the trip page is meant
// to be shared - so everything that endpoint returns is, in effect,
// published to whoever holds the link. It returned the whole job record.
//
// These tests are written the way the risk actually presents itself: not
// "does publicBrief copy six fields" (it obviously does) but "can any
// private value reach a response at all". So the central case builds a job
// whose every private field carries a distinctive marker string, serializes
// the public view exactly as the route does, and searches the JSON for each
// marker. A field added to TripBriefInput or to Job later is caught by that
// case without anybody remembering to update this file.
//
// Run: npm run test:public-brief

import { publicBrief, publicJob, PUBLIC_BRIEF_FIELDS } from "./publicBrief";
import { check, finish, heading, section } from "./testutil";
import type { Job } from "./jobs";
import type { Itinerary, TripBriefInput } from "./types";

heading("what a shared trip link may disclose");

/** A marker that cannot occur by accident and is trivially greppable in a
 * blob of JSON. Every private field gets its own. */
const M = (name: string) => `__PRIVATE_${name}__`;

const fullBrief = (): TripBriefInput => ({
  // The public half.
  destinations: ["Rome", "Florence"],
  start_date: "2027-05-01",
  end_date: "2027-05-05",
  party_composition: "couple",
  interests: ["food", "history"],
  language: "en",
  // The private half - every one of these is real personal data and every
  // one was on the response.
  origin: M("origin"),
  party_size: 2,
  budget_total_eur: 314159,
  pace: "moderate",
  must_see: [M("must_see")],
  dietary_constraints: [M("dietary")],
  mobility_constraints: [M("mobility")],
  hard_no: [M("hard_no")],
  needs_lodging: false,
  accommodation_location: M("accommodation"),
  needs_flight: false,
  transport_preference: "taxi_rideshare",
  arrival_date: "2027-05-01",
  arrival_time: M("arrival_time"),
  arrival_airport: M("arrival_airport"),
  departure_date: "2027-05-05",
  departure_time: M("departure_time"),
  departure_airport: M("departure_airport"),
});

const itinerary = (marker: string): Itinerary =>
  ({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 2000, note: "" },
    trip_summary: marker,
    key_decisions: [],
    days: [],
    things_to_skip: [],
  }) as unknown as Itinerary;

const fullJob = (): Job => ({
  id: "job-1",
  status: "done",
  brief: fullBrief(),
  refinement: { question: M("question"), baseItinerary: itinerary(M("base_itinerary")) },
  result: itinerary("the trip the traveller sees"),
  createdAt: 1,
  updatedAt: 2,
  testMode: true,
  ttlSeconds: 1000,
});

function main() {
  {
    section("the field list is the contract");

    const pub = publicBrief(fullBrief());
    check(
      "publicBrief returns exactly the allowlisted keys",
      JSON.stringify(Object.keys(pub).sort()) === JSON.stringify([...PUBLIC_BRIEF_FIELDS].sort()),
      Object.keys(pub).sort().join(",")
    );
    check("and they carry the real values", pub.destinations.join(",") === "Rome,Florence");
    check("  dates", pub.start_date === "2027-05-01" && pub.end_date === "2027-05-05");
    check("  party composition", pub.party_composition === "couple");
    check("  interests", pub.interests.join(",") === "food,history");
    check("  language", pub.language === "en");
  }

  {
    section("no private value reaches a public response");

    // The whole point. Serialized the way the route does it, then searched
    // for each marker - so a field added to TripBriefInput or to Job in
    // future fails here without this file being touched.
    const serialized = JSON.stringify(publicJob(fullJob()));

    for (const name of [
      "origin",
      "must_see",
      "dietary",
      "mobility",
      "hard_no",
      "accommodation",
      "arrival_time",
      "arrival_airport",
      "departure_time",
      "departure_airport",
      "question",
      "base_itinerary",
    ]) {
      check(`${name} is absent from the response`, serialized.includes(M(name)) === false);
    }

    // Numbers and enums have no marker, so they are checked by name.
    check("the budget is absent", serialized.includes("314159") === false);
    check("party_size is absent", serialized.includes("party_size") === false);
    check("pace is absent", serialized.includes('"pace"') === false);
    check("needs_lodging is absent", serialized.includes("needs_lodging") === false);
    check("needs_flight is absent", serialized.includes("needs_flight") === false);
    check("transport_preference is absent", serialized.includes("transport_preference") === false);
    check("the refinement block is absent entirely", serialized.includes("refinement") === false);
    check("testMode is absent", serialized.includes("testMode") === false);

    // ...while everything the page needs is still there. A redaction that
    // broke the page would be reverted, so this half matters as much.
    check("the itinerary is still served", serialized.includes("the trip the traveller sees"));
    check("the destinations are still served", serialized.includes("Florence"));
    check("the status is still served", serialized.includes('"status":"done"'));
  }

  {
    section("publicJob names its fields rather than spreading");

    // A spread-and-delete would publish anything later added to Job by
    // default. The assertion is on the key set, because that is the thing
    // that would silently change.
    const keys = Object.keys(publicJob(fullJob())).sort();
    const expected = [
      "brief",
      "createdAt",
      "error",
      "id",
      "progress",
      "quality",
      "result",
      "status",
      "timings",
      "ttlSeconds",
      "updatedAt",
    ];
    check("the public job's keys are exactly the named set", JSON.stringify(keys) === JSON.stringify(expected), keys.join(","));
  }

  {
    section("a brief that cannot be read must not break the page");

    // isJob only checks that `brief` is a non-null object, so a record
    // written by an older version really can be missing any field. The
    // alternative to a thin header here is a traveller who cannot open
    // their own finished trip, which is why this degrades rather than
    // throws.
    for (const [label, raw] of [
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
      ["a string", "brief"],
      ["an array", []],
      ["an empty object", {}],
    ] as [string, unknown][]) {
      let threw = false;
      let read;
      try {
        read = publicBrief(raw);
      } catch {
        threw = true;
      }
      check(`${label} does not throw`, threw === false);
      check(`  and reads as an empty brief`, read?.destinations.length === 0 && read?.start_date === "");
    }

    check(
      "junk inside the arrays is dropped, not rendered",
      publicBrief({ destinations: ["Rome", null, 7, { city: "Paris" }] }).destinations.join(",") === "Rome"
    );
    check(
      "a non-string date is dropped",
      publicBrief({ start_date: 20270501 }).start_date === ""
    );
    check(
      "an unknown language falls back to en",
      publicBrief({ language: "de" }).language === "en"
    );
    check("and a known one survives", publicBrief({ language: "bg" }).language === "bg");
  }

  finish();
}

main();
