// Why a trip page has nothing to show, as a value rather than a sentence.
//
// WHAT WAS WRONG. /api/job/[id] is careful work: it tells apart a record
// that expired, a worker that restarted mid-generation, a job sitting in a
// queue with no consumer, and a record written by an older build - and it
// checks the worker's heartbeat before accusing the queue, because its own
// comment records what the wrong accusation cost ("every traveler who
// believed that message and resubmitted commissioned a second real
// generation, which lengthened the queue, which made the next one wait
// longer").
//
// All four then arrived at the trip page as one string and were rendered
// as one line of red text with a link to the homepage. The page threw away
// every distinction the route had drawn, and with it the only thing a
// traveller could have done about any of them - because the four cases do
// not want the same action:
//
//   expired       the link is just old. Nothing is wrong and nothing can
//                 be retried; their OTHER saved trips may well still be
//                 alive, which is the useful thing to say.
//   interrupted   the one case where trying again works, and the only one
//                 where it is worth spending a generation on.
//   planner_down  retrying is actively bad advice. The route says so:
//                 "a retry there just buys them another five minutes of
//                 spinner."
//   unreadable    will not fix itself, so plan a new one.
//
// So the reason travels as a code. The sentence still comes with it (the
// route writes better sentences than a client-side lookup table could),
// but the code is what decides whether a Try again button exists at all.
//
// Run: npm run test:trip-failure

export const TRIP_FAILURE_REASONS = [
  /** The record is gone - past its lifetime, or never existed. */
  "expired",
  /** A worker died with this job in its hands. Retrying works. */
  "interrupted",
  /** Nothing is consuming the queue, so this never started. Retrying does
   * not work, and offering it would waste the traveller's time. */
  "planner_down",
  /** Stored by a build that wrote a different shape. */
  "unreadable",
  /** The worker finished and recorded a real failure. */
  "failed",
  /** The client gave up waiting. The job may yet finish, so this is the
   * one "failure" where the right move is to look again. */
  "timed_out",
  /** The request never completed - no network, or the server never
   * answered. Says nothing about the trip itself. */
  "unreachable",
] as const;

export type TripFailureReason = (typeof TRIP_FAILURE_REASONS)[number];

export function isTripFailureReason(value: unknown): value is TripFailureReason {
  return typeof value === "string" && (TRIP_FAILURE_REASONS as readonly string[]).includes(value);
}

/** Whether a Try again button should exist for this reason.
 *
 * Only where trying again has a real chance of working. A button that
 * cannot help is worse than no button: it costs a generation, it costs
 * another wait, and it teaches the traveller that the thing does not work.
 *
 * `timed_out` is deliberately NOT here even though it looks retryable -
 * the job behind it is very likely still running, and the thing to do is
 * reload and look, not start a second one. That reload is the action the
 * view offers instead. */
export function canRetry(reason: TripFailureReason): boolean {
  return reason === "interrupted" || reason === "failed";
}

/** Whether to show the traveller their other saved trips.
 *
 * Worth it when THIS link is the problem rather than the service - their
 * other bookmarks are probably fine, and the recent-trips list is already
 * in localStorage. Not worth it when the planner itself is down, because
 * every other link would fail the same way. */
export function suggestOtherTrips(reason: TripFailureReason): boolean {
  return reason === "expired" || reason === "unreadable";
}

/** Whether to print the route's own sentence underneath the explanation.
 *
 * Almost never, and the reason is a stutter that was visible the moment
 * this was rendered: the route's words for an interrupted generation
 * ("This generation stopped unexpectedly - the server restarted while it
 * was running. Please try again.") are the SAME POINT as the paragraph
 * written for that reason, in slightly different words, and reading both
 * one under the other is worse than reading either.
 *
 * `failed` is the exception, and it is the one that matters: that is a
 * worker-recorded error, where the route's sentence is the only specific
 * thing anybody knows about what went wrong. Every other reason has copy
 * written for exactly it.
 *
 * A predicate rather than comparing the two strings, which is what this
 * was first: whether two sentences mean the same thing is not something a
 * prefix check can answer, and it got it wrong. */
export function showRouteDetail(reason: TripFailureReason): boolean {
  return reason === "failed";
}

/** The reason behind a failed poll, from the HTTP status and the body the
 * route sent.
 *
 * The route's own `reason` is believed when it sends one - it knows things
 * no status code can carry, in particular the difference between a worker
 * that restarted and a queue with nothing reading it, which are both
 * `status: "error"` on a 200 response. The status code is the fallback for
 * an older deployment, or any response that is not from this route. */
export function tripFailureReason(input: {
  status?: number;
  reason?: unknown;
  networkError?: boolean;
}): TripFailureReason {
  if (input.networkError) return "unreachable";
  if (isTripFailureReason(input.reason)) return input.reason;
  if (input.status === 404) return "expired";
  if (input.status === 410) return "expired";
  // A 500 from this route is the unreadable-record branch; anything else
  // in the 5xx range is the service, which the traveller cannot act on
  // either way, and both want "plan a new one" rather than "try again".
  if (input.status !== undefined && input.status >= 500) return "unreadable";
  return "failed";
}
