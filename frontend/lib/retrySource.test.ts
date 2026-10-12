// Whether a stalled trip may be started again, and from what.
//
// The decision behind POST /api/job/[id]/retry, extracted for the same
// reason lib/refineSource.ts was: no route handler in this app has a test,
// because driving one means standing up Next's request plumbing and a
// Redis client that reads process.env. So the decision lives in a pure
// function of the raw Redis value and this asserts it.
//
// THE THREE CHECKS THAT ARE ABOUT MONEY, and are the reason this file is
// more than a formality:
//
//   - A retry regenerates from the brief IN THE RECORD. The trip page only
//     holds a PublicTripBrief, which deliberately withholds
//     mobility_constraints, dietary_constraints, hard_no, the budget, the
//     origin, the party size and the named hotel (lib/publicBrief.ts). A
//     retry built from what the page has would have planned a DIFFERENT
//     trip - wheelchair access, coeliac diet and budget quietly dropped -
//     for exactly the travellers who most need them honoured, and it would
//     have looked like it worked.
//   - A job that is merely YOUNG must not be retried. Duplicating a
//     generation that is about to finish spends a real model call for
//     nothing.
//   - A job may be retried ONCE. The original's quota slot is consumed at
//     enqueue and never refunded, so charging a second slot for a crash on
//     our side would be wrong - while a free retry with no limit would be
//     a way around the quota entirely: enqueue one trip, retry it forever.
//
// Run: npm run test:retry-source

import { retrySource } from "./retrySource";
import { STALE_PENDING_MS, STALE_RUNNING_MS, type Job } from "./jobs";
import { check, finish, heading, section } from "./testutil";
import type { TripBriefInput } from "./types";

heading("whether a stalled trip can be started again");

const PRIVATE_BRIEF: TripBriefInput = {
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
};

const job = (over: Partial<Job> = {}): Job => ({
  id: "job-1",
  status: "running",
  brief: PRIVATE_BRIEF,
  createdAt: Date.now() - 2 * STALE_RUNNING_MS,
  updatedAt: Date.now() - 2 * STALE_RUNNING_MS,
  ...over,
});

section("what the retry regenerates from");

{
  // The whole reason this is a server-side route.
  const source = retrySource(job());
  check("a stalled running job can be retried", source.ok === true, JSON.stringify(source));
  if (source.ok) {
    check(
      "and it carries the PRIVATE brief, not the public one",
      source.brief.mobility_constraints?.includes("cannot manage stairs") === true,
      JSON.stringify(source.brief.mobility_constraints)
    );
    check("including the dietary constraints", source.brief.dietary_constraints?.includes("coeliac") === true);
    check("the budget", source.brief.budget_total_eur === 3000, String(source.brief.budget_total_eur));
    check("and where they are flying from", source.brief.origin === "Sofia", source.brief.origin);
  }
}

{
  // A record written through JSON, which is how it actually arrives.
  const source = retrySource(JSON.stringify(job()));
  check("a JSON string out of Redis is read the same way", source.ok === true, JSON.stringify(source));
}

section("a job that is still working must not be duplicated");

{
  const young = retrySource(job({ status: "running", updatedAt: Date.now() }));
  check("a running job touched just now is refused", young.ok === false);
  check("  as a conflict, not a not-found", young.ok === false && young.status === 409, String(!young.ok && young.status));
  check(
    "  and says not to start a second one",
    young.ok === false && /still generating/i.test(young.detail),
    !young.ok ? young.detail : ""
  );

  const youngPending = retrySource(job({ status: "pending", updatedAt: Date.now() }));
  check("a pending job that was just queued is refused too", youngPending.ok === false);
}

{
  // Past the staleness thresholds the route already publishes, both
  // statuses are retryable - the page and this must not disagree about
  // whether a trip is dead.
  const stalePending = retrySource(job({ status: "pending", updatedAt: Date.now() - 2 * STALE_PENDING_MS }));
  check("a pending job nothing picked up is retryable", stalePending.ok === true, JSON.stringify(stalePending));
  const staleRunning = retrySource(job({ status: "running", updatedAt: Date.now() - 2 * STALE_RUNNING_MS }));
  check("a running job whose worker died is retryable", staleRunning.ok === true, JSON.stringify(staleRunning));
  // A record with no usable timestamp never reaches stallReason, despite
  // the careful branch stallReason has for exactly that case: isJob
  // requires Number.isFinite(updatedAt), so readJobRecord rejects the
  // record one layer earlier and this is a not-found. Asserted as what it
  // IS rather than what stallReason's comment suggests, because the
  // traveller-visible outcome is the same either way - plan a new one -
  // and a test that asserted the other branch would be asserting a path
  // nothing can take.
  const noClock = retrySource(job({ status: "running", updatedAt: Number.NaN }));
  check(
    "a record with a broken clock is rejected before stallReason sees it",
    noClock.ok === false && noClock.status === 404,
    JSON.stringify(noClock)
  );
}

{
  const errored = retrySource(job({ status: "error", updatedAt: Date.now(), error: "model refused" }));
  check("a job the worker recorded as failed is retryable whatever its age", errored.ok === true, JSON.stringify(errored));
}

section("a finished trip is not an error");

{
  const done = retrySource(job({ status: "done", updatedAt: Date.now() }));
  check("a done job is refused", done.ok === false);
  check("  as a conflict", done.ok === false && done.status === 409, String(!done.ok && done.status));
  check(
    "  with nothing to retry",
    done.ok === false && /nothing to retry/i.test(done.detail),
    !done.ok ? done.detail : ""
  );
}

section("once, not forever");

{
  const again = retrySource(job({ retriedAt: Date.now() - 60_000 }));
  check("a job already started again is refused", again.ok === false);
  check("  as a rate limit", again.ok === false && again.status === 429, String(!again.ok && again.status));
  check(
    "  and points at planning a new one",
    again.ok === false && /plan a new one/i.test(again.detail),
    !again.ok ? again.detail : ""
  );
  // The guard is the field's PRESENCE, so a zero timestamp still counts.
  const atEpoch = retrySource(job({ retriedAt: 0 }));
  check("even one recorded at the epoch", atEpoch.ok === false && atEpoch.status === 429);
}

section("records that are not a job, or not usable");

{
  for (const raw of [null, undefined, "", "not json", "{}", 7, [], { id: "x" }]) {
    const source = retrySource(raw);
    check(`${JSON.stringify(raw)} is not found`, source.ok === false && source.status === 404, JSON.stringify(source));
  }
}

{
  // isJob checks only that `brief` is a non-null object, and records live
  // for up to 400 days - so a brief that no longer validates is reachable
  // without anyone editing anything. It goes straight into a model prompt,
  // so saying so beats prompting with it.
  const bad = retrySource(job({ brief: { destinations: [] } as unknown as TripBriefInput }));
  check("a brief that no longer validates is refused", bad.ok === false);
  check("  as unprocessable", bad.ok === false && bad.status === 422, String(!bad.ok && bad.status));
  check(
    "  naming what is wrong with it",
    bad.ok === false && bad.detail.length > 30,
    !bad.ok ? bad.detail : ""
  );
}

check(
  "nothing here ever throws",
  (() => {
    for (const raw of [null, undefined, 0, "", "[]", { brief: null }, { status: "done" }, Symbol("x")]) {
      try {
        retrySource(raw);
      } catch {
        return false;
      }
    }
    return true;
  })()
);

finish();
