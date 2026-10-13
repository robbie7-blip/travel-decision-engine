// A failed pushback must not lose the revision it already paid for.
//
// A refinement is a fresh job at a fresh id, and it is commissioned the
// moment it is submitted: the same model call, the same quota slot and the
// same daily budget as a brand new trip. refineItinerary used to hand that
// id back only on SUCCESS, so a poll that failed afterwards - a timeout, a
// dropped connection, a worker that restarted - left the caller never
// knowing the id at all. The record sat in Redis, very possibly finished,
// at a URL nobody held, and the traveller was looking at the old itinerary
// and a sentence in red.
//
// So the id is handed over BEFORE the polling starts. That ordering is the
// whole fix, and it is what this asserts - including in the failure cases,
// which are the only ones that matter here: on success the return value
// carries it anyway.
//
// Run: npm run test:refine-handover

import { ApiError, refineItinerary } from "./api";
import { check, finish, heading, section } from "./testutil";

heading("a failed pushback keeps hold of its revision");

const JSON_HEADERS = { "content-type": "application/json" };

/** Replaces fetch with a script of responses, one per call, and records
 * what was asked for. */
function installFetch(script: Array<() => Response | Promise<Response>>) {
  const calls: string[] = [];
  let i = 0;
  (globalThis as { fetch?: unknown }).fetch = async (input: unknown) => {
    calls.push(String(input));
    const step = script[Math.min(i, script.length - 1)];
    i++;
    return step();
  };
  return calls;
}

const created = (jobId: string) =>
  new Response(JSON.stringify({ jobId }), { status: 202, headers: JSON_HEADERS });

const jobBody = (over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "revision-1",
      status: "running",
      brief: { destinations: ["Rome"], start_date: "2027-05-01", end_date: "2027-05-04", party_composition: "couple", interests: [], language: "en" },
      createdAt: 1,
      updatedAt: 1,
      ...over,
    }),
    { status: 200, headers: JSON_HEADERS }
  );

async function main() {
  section("the id arrives before anything can go wrong");

  {
    // The poll fails outright on its first request.
    installFetch([() => created("revision-1"), () => { throw new TypeError("network down"); }]);
    let handed: string | null = null;
    let error: unknown = null;
    try {
      await refineItinerary("job-original", "cheaper hotel?", undefined, (id) => {
        handed = id;
      });
    } catch (e) {
      error = e;
    }
    check("the refinement failed", error instanceof ApiError, String(error));
    check("but the revision's id was handed over", handed === "revision-1", String(handed));
    check(
      "and the failure says it was unreachable, not that the trip is gone",
      error instanceof ApiError && error.reason === "unreachable",
      error instanceof ApiError ? String(error.reason) : "not an ApiError"
    );
  }

  {
    // The worker recorded a failure on the revision.
    installFetch([
      () => created("revision-2"),
      () => jobBody({ status: "error", error: "This generation stopped unexpectedly.", reason: "interrupted" }),
    ]);
    let handed: string | null = null;
    try {
      await refineItinerary("job-original", "cheaper hotel?", undefined, (id) => {
        handed = id;
      });
    } catch {
      /* expected */
    }
    check("a stalled revision still hands its id over", handed === "revision-2", String(handed));
  }

  section("nothing to hand over when nothing was created");

  {
    // /api/refine itself refused - rate limited, say. No job exists, so
    // there is nothing to offer and the callback must NOT fire with
    // something made up.
    installFetch([
      () => new Response(JSON.stringify({ detail: "Too many requests." }), { status: 429, headers: JSON_HEADERS }),
    ]);
    let handed: string | null = null;
    let error: unknown = null;
    try {
      await refineItinerary("job-original", "cheaper hotel?", undefined, (id) => {
        handed = id;
      });
    } catch (e) {
      error = e;
    }
    check("the refusal is reported", error instanceof ApiError, String(error));
    check("  with the route's own sentence", error instanceof ApiError && /Too many requests/.test(error.message), error instanceof ApiError ? error.message : "");
    check("  and no id was invented", handed === null, String(handed));
  }

  section("the happy path is unchanged");

  {
    installFetch([
      () => created("revision-3"),
      () =>
        jobBody({
          status: "done",
          result: { trip_summary: "ok", days: [], key_decisions: [], things_to_skip: [], budget_feasibility: {} },
        }),
    ]);
    let handed: string | null = null;
    const out = await refineItinerary("job-original", "cheaper hotel?", undefined, (id) => {
      handed = id;
    });
    check("it returns the revision", out.jobId === "revision-3", out.jobId);
    check("and the callback agreed with the return value", handed === out.jobId, `${handed} vs ${out.jobId}`);
  }

  section("the callback is optional");

  {
    installFetch([() => created("revision-4"), () => { throw new TypeError("network down"); }]);
    let threw: unknown = null;
    try {
      await refineItinerary("job-original", "cheaper hotel?");
    } catch (e) {
      threw = e;
    }
    check("omitting it does not break the call", threw instanceof ApiError, String(threw));
  }

  finish();
}

void main();
