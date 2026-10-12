// Why a trip page has nothing to show, and what to offer about it.
//
// WHAT THIS IS FOR. /api/job/[id] is careful work: it tells apart a record
// that expired, a worker that restarted mid-generation, a job sitting in a
// queue with no consumer, and a record written by an older build - and it
// checks the worker's heartbeat before accusing the queue, because its own
// comment records what the wrong accusation cost: "every traveler who
// believed that message and resubmitted commissioned a second real
// generation, which lengthened the queue, which made the next one wait
// longer."
//
// All four of those then arrived at the trip page as one string and were
// rendered as one line of red text with a link to the homepage. Every
// distinction the route had drawn was thrown away at the last step, and
// with it the only thing a traveller could have done about any of them.
//
// The checks that matter here are the two about MONEY AND TIME, because
// getting either backwards is what the route's comment is a monument to:
//
//   - canRetry must be false for planner_down. A retry there cannot work,
//     and offering it spends a generation from somebody's allowance to buy
//     them another five minutes of waiting.
//   - canRetry must be false for timed_out. The job behind it is very
//     likely still running; starting a second one duplicates a real model
//     call for a trip that is about to arrive.
//
// Run: npm run test:trip-failure

import {
  TRIP_FAILURE_REASONS,
  canRetry,
  isTripFailureReason,
  showRouteDetail,
  suggestOtherTrips,
  tripFailureReason,
  type TripFailureReason,
} from "./tripFailure";
import { TRANSLATIONS } from "./i18n";
import { check, finish, heading, section } from "./testutil";

heading("why a trip page has nothing to show");

section("which failures are worth spending a generation on");

// Stated as a table rather than per-case, so adding a reason without
// deciding this is impossible to do quietly.
const RETRYABLE: Record<TripFailureReason, boolean> = {
  expired: false,
  interrupted: true,
  planner_down: false,
  unreadable: false,
  failed: true,
  timed_out: false,
  unreachable: false,
};

for (const reason of TRIP_FAILURE_REASONS) {
  check(
    `${reason}: retry is ${RETRYABLE[reason] ? "offered" : "NOT offered"}`,
    canRetry(reason) === RETRYABLE[reason]
  );
}

check(
  "a dead queue is never offered a retry - the route says it buys another five minutes of spinner",
  canRetry("planner_down") === false
);
check(
  "nor is a client-side timeout, whose job is probably still running",
  canRetry("timed_out") === false
);
check("an interrupted generation IS, which is the one case it works", canRetry("interrupted") === true);

section("when to show their other saved trips");

// Worth it when THIS link is the problem. Pointless when the service is
// down, because every other link would fail the same way - and actively
// unhelpful on a retryable failure, where the thing to do is on screen.
const OTHERS: Record<TripFailureReason, boolean> = {
  expired: true,
  interrupted: false,
  planner_down: false,
  unreadable: true,
  failed: false,
  timed_out: false,
  unreachable: false,
};
for (const reason of TRIP_FAILURE_REASONS) {
  check(`${reason}: other trips ${OTHERS[reason] ? "shown" : "not shown"}`, suggestOtherTrips(reason) === OTHERS[reason]);
}
check(
  "never alongside a dead planner, where every other link fails too",
  suggestOtherTrips("planner_down") === false
);

section("when the route's own sentence is worth printing too");

// It was printed for every reason at first, and the stutter was visible
// the moment the page was rendered: the route's words for an interrupted
// generation are the same point as the paragraph written for it, so the
// view said it twice. Only a worker-recorded failure carries information
// the copy cannot - every other reason has copy written for exactly it.
for (const reason of TRIP_FAILURE_REASONS) {
  check(
    `${reason}: route detail ${reason === "failed" ? "shown" : "not shown"}`,
    showRouteDetail(reason) === (reason === "failed")
  );
}

section("reading a reason off a response");

check("the route's own code wins", tripFailureReason({ status: 500, reason: "interrupted" }) === "interrupted");
check("every reason survives the round trip", TRIP_FAILURE_REASONS.every((r) => tripFailureReason({ reason: r }) === r));

check("a network failure is its own thing", tripFailureReason({ networkError: true }) === "unreachable");
check(
  "and it wins over anything else, because there was no response to read",
  tripFailureReason({ networkError: true, status: 404, reason: "interrupted" }) === "unreachable"
);

check("404 means gone", tripFailureReason({ status: 404 }) === "expired");
check("410 means gone too", tripFailureReason({ status: 410 }) === "expired");
check("500 is the unreadable-record branch", tripFailureReason({ status: 500 }) === "unreadable");
check("503 is the service, and wants the same advice", tripFailureReason({ status: 503 }) === "unreadable");
check("anything else falls back to a plain failure", tripFailureReason({ status: 400 }) === "failed");
check("as does nothing at all", tripFailureReason({}) === "failed");

{
  // A body from something that is not this route - a proxy's error page, a
  // field renamed - must not be trusted into a reason.
  for (const junk of [undefined, null, "", "nonsense", 7, {}, [], "EXPIRED", "planner-down"]) {
    check(
      `reason ${JSON.stringify(junk)} is not believed`,
      tripFailureReason({ status: 404, reason: junk }) === "expired",
      String(tripFailureReason({ status: 404, reason: junk }))
    );
  }
  check("and isTripFailureReason agrees", TRIP_FAILURE_REASONS.every(isTripFailureReason));
  check("while rejecting a near miss", isTripFailureReason("planner-down") === false);
}

section("every reason has something to say, in both languages");

// The view looks copy up by reason. A reason with no heading is a blank
// page on the one surface that is already apologising.
const COPY_KEY: Record<TripFailureReason, string> = {
  expired: "expired",
  interrupted: "interrupted",
  planner_down: "plannerDown",
  unreadable: "unreadable",
  failed: "failed",
  timed_out: "timedOut",
  unreachable: "unreachable",
};

for (const language of ["en", "bg"] as const) {
  const copy = TRANSLATIONS[language].trip.failed as unknown as Record<
    string,
    { heading?: string; body?: string } | string
  >;
  for (const reason of TRIP_FAILURE_REASONS) {
    const entry = copy[COPY_KEY[reason]];
    const ok =
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.heading === "string" &&
      entry.heading.trim() !== "" &&
      typeof entry.body === "string" &&
      entry.body.trim() !== "";
    check(`${language}/${reason} has a heading and a body`, ok, JSON.stringify(entry));
  }
  // The one string whose absence would let somebody spend a generation
  // without being told.
  const note = TRANSLATIONS[language].trip.failed.retryNote;
  check(`${language} says what Start it again costs`, typeof note === "string" && note.trim() !== "", note);
}

finish();
