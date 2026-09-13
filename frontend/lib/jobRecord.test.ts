// The job envelope: reading it, and deciding when it is dead.
//
// Every reader did `JSON.parse(raw) as Job` or `raw as Job` - a shape
// asserted over a value in Redis that outlives the deploy that wrote it.
// Three readers, three different bad outcomes from one bad record:
//
//   - GET /api/job/[id] parsed OUTSIDE any try, on an endpoint the trip
//     page polls every 400ms, so a non-JSON value was an unhandled throw;
//   - a value that parses but is not a job (a number, an array, a record
//     with no `status`) came back 200 with nothing the client recognises,
//     so pollJob looped the full five minutes;
//   - the worker's processJob parsed it too, inside a catch that logs and
//     returns to BRPOP - so the job was dropped without ever being marked
//     failed, and the page polled a "running" record that nothing was
//     running.
//
// And stallReason could not rescue any of it, which is the part worth
// measuring. `Date.now() - undefined` is NaN and every comparison against
// NaN is false, so a job stuck at "running" with a missing, NaN, Infinity
// or string updatedAt was never stalled at ANY age - by the one function
// written to stop exactly that five-minute spinner.
//
// Run: npm run test:job-record

import { STALE_PENDING_MS, STALE_RUNNING_MS, isJob, readJobRecord, stallReason, type Job } from "./jobs";
import { check, finish, heading, section } from "./testutil";

heading("job records");

const job = (over: Record<string, unknown> = {}): unknown => ({
  id: "job-1",
  status: "running",
  brief: { destinations: ["Rome"] },
  createdAt: 1_700_000_000_000,
  updatedAt: Date.now(),
  ...over,
});

function main() {
  section("a real record reads back");

  {
    const raw = JSON.stringify(job());
    const parsed = readJobRecord(raw);
    check("from a JSON string", parsed !== null && parsed.id === "job-1", JSON.stringify(parsed?.id));
    // The Upstash client auto-deserializes, ioredis never does, so both
    // shapes reach this function and every reader open-coded the ternary.
    check("and from an already-parsed object", readJobRecord(job())?.id === "job-1");
    check("every status is allowed", ["pending", "running", "done", "error"].every((s) => isJob(job({ status: s }))));
  }

  section("records that must not be served as jobs");

  {
    // The five shapes measured against the real readers.
    for (const raw of ["null", "42", "[]", '"a string"', "{}", "[1,2]", "true"]) {
      check(`${raw} is not a job`, readJobRecord(raw) === null, JSON.stringify(readJobRecord(raw)));
    }
    // Non-JSON, which is the case that threw in the route.
    for (const raw of ["", "not json", "{", '{"id":']) {
      let threw = false;
      try {
        readJobRecord(raw);
      } catch {
        threw = true;
      }
      check(`${JSON.stringify(raw)} does not throw`, threw === false);
      check("  and is not a job", readJobRecord(raw) === null);
    }
    check("null reads as nothing", readJobRecord(null) === null);
    check("undefined reads as nothing", readJobRecord(undefined) === null);
  }

  {
    // Field by field, because each of these is something a reader touches.
    for (const [label, over] of [
      ["no id", { id: undefined }],
      ["an empty id", { id: "" }],
      ["a numeric id", { id: 7 }],
      ["no status", { status: undefined }],
      ["an unknown status", { status: "finished" }],
      ["a numeric status", { status: 2 }],
      ["no brief", { brief: undefined }],
      ["a string brief", { brief: "Rome" }],
      ["a null brief", { brief: null }],
      ["no createdAt", { createdAt: undefined }],
      ["a NaN createdAt", { createdAt: Number.NaN }],
      ["no updatedAt", { updatedAt: undefined }],
      ["a string updatedAt", { updatedAt: "2027-05-01" }],
      ["a NaN updatedAt", { updatedAt: Number.NaN }],
    ] as [string, Record<string, unknown>][]) {
      check(`${label} is not a job`, isJob(job(over)) === false, JSON.stringify(job(over)));
    }
  }

  {
    // An array with the right keys is still not a job - the readers spread
    // it (`{...job, status: "error"}`) and index it.
    const arrayish = Object.assign([], job());
    check("an array carrying job fields is refused", isJob(arrayish) === false);
  }

  section("stalling: the five-minute spinner");

  {
    const fresh = Date.now();
    check("a job touched just now is not stalled", stallReason(job({ updatedAt: fresh }) as Job) === null);
    check(
      "a pending job inside its window is not stalled",
      stallReason(job({ status: "pending", updatedAt: fresh }) as Job) === null
    );
    check(
      "a long-running job is a restart",
      stallReason(job({ updatedAt: fresh - STALE_RUNNING_MS - 1000 }) as Job) === "worker_restarted"
    );
    check(
      "a long-pending job is an offline worker",
      stallReason(job({ status: "pending", updatedAt: fresh - STALE_PENDING_MS - 1000 }) as Job) === "worker_offline"
    );
    check(
      "a finished job is never stalled, however old",
      stallReason(job({ status: "done", updatedAt: 0 }) as Job) === null
    );
  }

  {
    // The defect. Every one of these returned null before - not "not yet",
    // but never, at any age - so the page polled for the full MAX_WAIT_MS
    // and was told the generation was taking longer than expected.
    for (const [label, updatedAt] of [
      ["missing", undefined],
      ["NaN", Number.NaN],
      ["a string", "2027-05-01"],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["an object", {}],
    ] as [string, unknown][]) {
      check(
        `a running job with a ${label} updatedAt is stalled`,
        stallReason(job({ updatedAt }) as Job) === "worker_restarted",
        String(stallReason(job({ updatedAt }) as Job))
      );
      check(
        `  and a pending one reads as offline`,
        stallReason(job({ status: "pending", updatedAt }) as Job) === "worker_offline",
        String(stallReason(job({ status: "pending", updatedAt }) as Job))
      );
    }

    // `null` coerced to 0 and DID stall, which is the tell that the old
    // guard was accidental rather than designed - the same field read as
    // "dead" or "immortal" depending on which falsy value it held.
    check(
      "a null updatedAt still stalls, as it always did",
      stallReason(job({ updatedAt: null }) as Job) === "worker_restarted"
    );

    // A job that is already finished must not be dragged into an error by
    // a bad timestamp - the result is sitting right there.
    check(
      "a done job with no updatedAt is still not stalled",
      stallReason(job({ status: "done", updatedAt: undefined }) as Job) === null
    );
    check(
      "nor is one already in error",
      stallReason(job({ status: "error", updatedAt: Number.NaN }) as Job) === null
    );
  }

  finish();
}

main();
