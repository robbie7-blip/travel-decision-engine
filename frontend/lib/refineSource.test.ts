// The decision /api/refine makes now that it no longer takes the brief and
// the itinerary from the request body.
//
// This is the test that would have caught the change breaking pushback. No
// route handler in this app has one - driving a Next route means standing
// up its request plumbing and a Redis client that reads process.env - so
// the decision was extracted into lib/refineSource.ts and the route reduced
// to plumbing. What is asserted here is exactly what the route does with
// the value it reads out of Redis.
//
// Run: npm run test:refine-source

import { refineSource } from "./refineSource";
import { check, finish, heading, section } from "./testutil";
import type { Job } from "./jobs";
import type { Itinerary, TripBriefInput } from "./types";

heading("the trip a refinement is built from");

const brief = (over: Partial<TripBriefInput> = {}): TripBriefInput => ({
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2027-05-01",
  end_date: "2027-05-04",
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 3000,
  pace: "moderate",
  interests: ["food"],
  must_see: [],
  dietary_constraints: ["coeliac"],
  mobility_constraints: ["cannot manage stairs"],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
  ...over,
});

const itinerary = (): Itinerary =>
  ({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 2000, note: "" },
    trip_summary: "four days in Rome",
    key_decisions: [],
    days: [{ day: 1, date: "2027-05-01", city: "Rome", theme: "arrival", items: [] }],
    things_to_skip: [],
  }) as unknown as Itinerary;

const job = (over: Partial<Job> = {}): Job => ({
  id: "job-1",
  status: "done",
  brief: brief(),
  result: itinerary(),
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

/** As Redis actually hands it back. Both shapes reach this code: the
 * Upstash REST client auto-deserializes JSON-looking strings, ioredis
 * always returns a string. */
const stored = (j: unknown) => JSON.stringify(j);

function main() {
  {
    section("a finished trip is refinable");

    const ok = refineSource(stored(job()));
    check("a stored job is accepted", ok.ok === true);
    if (ok.ok) {
      check("its brief is the one that GENERATED the trip", ok.brief.destinations.join(",") === "Rome");
      // The point of reading the brief server-side: the private half
      // survives into the refinement, where before it depended on the
      // client posting back everything it had been given.
      check(
        "including the half no longer sent to the client",
        ok.brief.mobility_constraints.join(",") === "cannot manage stairs"
      );
      check("  and the dietary half", ok.brief.dietary_constraints.join(",") === "coeliac");
      check("  and the budget", ok.brief.budget_total_eur === 3000);
      check("the base itinerary is the stored result", ok.baseItinerary.trip_summary === "four days in Rome");
    }

    // Both client shapes, since the route passes whatever redis.get gave it.
    const asObject = refineSource(job() as unknown);
    check("an already-deserialized record is accepted too", asObject.ok === true);
  }

  {
    section("a trip that is not finished yet");

    for (const status of ["pending", "running"] as const) {
      const res = refineSource(stored(job({ status, result: undefined })));
      check(`a ${status} job is refused`, res.ok === false);
      check("  with 409, which means wait rather than start again", res.ok === false && res.status === 409);
    }

    // A "done" job with no result is the shape pollJob already refuses on
    // the client. Without checking `result` as well as `status` it would
    // arrive as `baseItinerary: undefined`, cast into a model prompt.
    const noResult = refineSource(stored(job({ status: "done", result: undefined })));
    check('a "done" job with no result is refused', noResult.ok === false);
    check("  also 409", noResult.ok === false && noResult.status === 409);

    const errored = refineSource(stored(job({ status: "error", result: undefined, error: "boom" })));
    check("a failed job is refused", errored.ok === false && errored.status === 409);
  }

  {
    section("a value that is not a job");

    // Everything readJobRecord refuses. 404 on purpose: the advice is
    // "generate it again", not "wait".
    for (const [label, raw] of [
      ["a missing key", null],
      ["undefined", undefined],
      ["unparseable JSON", "{"],
      ["a bare string", '"nope"'],
      ["a number", "42"],
      ["an array", "[]"],
      ["an empty object", "{}"],
      ["a job with no id", stored({ ...job(), id: "" })],
      ["a job with an unknown status", stored({ ...job(), status: "finished" })],
      ["a job with a NaN updatedAt", stored({ ...job(), updatedAt: Number.NaN })],
    ] as [string, unknown][]) {
      const res = refineSource(raw);
      check(`${label} is refused`, res.ok === false);
      check("  with 404", res.ok === false && res.status === 404);
    }
  }

  {
    section("a stored brief that no longer validates");

    // isJob checks only that `brief` is a non-null object, records live for
    // up to 400 days, and this brief goes straight into a model prompt.
    // 422 rather than 404: the record exists, and this will not fix itself.
    for (const [label, bad] of [
      ["no destinations", { ...brief(), destinations: [] }],
      ["a missing start date", { ...brief(), start_date: undefined }],
      ["an unreadable date", { ...brief(), start_date: "next spring" }],
      ["an empty object", {}],
    ] as [string, unknown][]) {
      const res = refineSource(stored(job({ brief: bad as TripBriefInput })));
      check(`a brief with ${label} is refused`, res.ok === false);
      check("  with 422, not 404 - the record is there, it is unusable", res.ok === false && res.status === 422);
      check(
        "  and the reason names what failed",
        res.ok === false && res.detail.includes("can no longer be read")
      );
    }

    // Not a throw. The route returns a status, and an exception here would
    // be a 500 on a case that has a real explanation.
    let threw = false;
    try {
      refineSource(stored(job({ brief: {} as TripBriefInput })));
    } catch {
      threw = true;
    }
    check("an invalid brief is reported, never thrown", threw === false);
  }

  {
    section("the three refusals are told apart");

    // Each carries different advice, and a traveller acting on the wrong
    // one wastes a generation: 404 start again, 409 wait, 422 start again
    // and this one will not fix itself.
    const statuses = [
      refineSource(null),
      refineSource(stored(job({ status: "pending", result: undefined }))),
      refineSource(stored(job({ brief: {} as TripBriefInput }))),
    ].map((r) => (r.ok ? "ok" : r.status));
    check("404, 409 and 422 are three distinct answers", JSON.stringify(statuses) === "[404,409,422]", JSON.stringify(statuses));

    const details = [
      refineSource(null),
      refineSource(stored(job({ status: "pending", result: undefined }))),
    ].map((r) => (r.ok ? "" : r.detail));
    check("the missing-trip message says to generate again", details[0].includes("generate it again"));
    check("the unfinished-trip message says to wait", details[1].includes("wait for it"));
  }

  finish();
}

main();
