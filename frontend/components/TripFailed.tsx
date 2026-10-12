"use client";

// The trip page with nothing to show.
//
// WHAT THIS REPLACES. One line:
//
//   {loadError} Plan another trip →
//
// 14px of red text on an otherwise empty page, with a link home - for the
// one person in this product who has waited the better part of a minute,
// spent a generation from their allowance, and in some cases paid. /404
// and the error boundary each got an illustration, a heading, an
// explanation and a way out last month (see DeadEndView); the page where
// failing actually costs the traveller something got a sentence.
//
// And it was the same sentence for everything, which is the part that
// mattered. /api/job/[id] tells apart a link that is simply old, a worker
// that restarted mid-generation, a queue with nothing reading it, and a
// record from an older build - it even checks the worker's heartbeat
// before accusing the queue, because its own comment records what the
// wrong accusation cost: "every traveler who believed that message and
// resubmitted commissioned a second real generation, which lengthened the
// queue, which made the next one wait longer." All four arrived here as a
// string and were rendered identically, so all that care reached the
// traveller as red text and a link to the homepage.
//
// THE ACTIONS ARE THE POINT, not the illustration. Each reason gets the
// one thing that can actually help:
//
//   interrupted / failed   Start it again. The only cases where that is
//                          worth a generation - so it is the only place
//                          the button appears, and it says what it spends.
//   timed_out              Check again. The trip is probably still coming;
//                          starting a second one would be the mistake.
//   unreachable            Check again, once there is signal. Says nothing
//                          about the trip.
//   planner_down           Deliberately NO retry. The route is explicit
//                          that one "just buys them another five minutes
//                          of spinner".
//   expired / unreadable   Plan a new one - and their OTHER saved trips,
//                          which are probably fine and are already in
//                          localStorage.
//
// Reuses .dead-end* from DeadEndView rather than inventing a second set of
// the same furniture, and renders no header of its own: TripView already
// has one above it.

import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import { canRetry, showRouteDetail, suggestOtherTrips, type TripFailureReason } from "@/lib/tripFailure";
import { getRecentTrips } from "@/lib/recentTrips";
import type { Language } from "@/lib/types";

/** Same file DeadEndView uses - 10KB of path data, kept out of the bundle
 * and cached once. */
const ILLUSTRATION = "/illustrations/off-the-map.svg";

/** Reason code to copy key. Spelled out rather than computed from the code
 * so adding a reason is a type error here instead of a missing heading on
 * the page. */
const COPY_KEY: Record<TripFailureReason, keyof Dictionary["trip"]["failed"]> = {
  expired: "expired",
  interrupted: "interrupted",
  planner_down: "plannerDown",
  unreadable: "unreadable",
  failed: "failed",
  timed_out: "timedOut",
  unreachable: "unreachable",
};

interface TripFailedProps {
  reason: TripFailureReason;
  /** The route's own sentence, which is more specific than the copy above
   * when it has something extra to say (a rate limit, a budget cap). Shown
   * under the explanation rather than instead of it, and only when it adds
   * something. */
  detail?: string;
  language: Language;
  t: Dictionary;
  /** Starts the generation again. COSTS a generation - see retryTrip. */
  onRetry?: () => void;
  /** Looks again without generating anything. */
  onRecheck?: () => void;
  retrying?: boolean;
  /** Why the last attempt to start it again did not work. */
  retryError?: string;
  /** This trip has already used its one free retry. */
  retried?: boolean;
}

export function TripFailed({
  reason,
  detail,
  language,
  t,
  onRetry,
  onRecheck,
  retrying = false,
  retryError = "",
  retried = false,
}: TripFailedProps) {
  const copy = t.trip.failed[COPY_KEY[reason]] as { heading: string; body: string };
  const suffix = language === "bg" ? "?lang=bg" : "";
  const retryable = canRetry(reason) && Boolean(onRetry) && !retried;
  // Whether a Check again button is actually RENDERED, not merely whether
  // a handler was passed. TripView always passes one, so testing the
  // handler left "Plan a new trip" styled as a secondary link on the
  // expired page - where it was the only thing to click. The page must
  // always have exactly one primary action.
  const recheckable = Boolean(onRecheck) && (reason === "timed_out" || reason === "unreachable");
  // Their own bookmarks, which for an old or unreadable link are the most
  // useful thing on the page: this one trip is gone, the others are very
  // likely still there. Read straight from localStorage - no account, no
  // request. The current trip is not in the list, because it never
  // finished.
  const others = suggestOtherTrips(reason) ? getRecentTrips().slice(0, 4) : [];

  return (
    <div className="dead-end">
      {/* Decorative: the heading beside it says the same thing in words. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ILLUSTRATION} alt="" className="dead-end-art" width={420} height={363} />

      <div className="dead-end-body">
        <h1 className="font-display dead-end-heading">{copy.heading}</h1>
        <p className="dead-end-text">{copy.body}</p>

        {/* Only where the route's sentence says something the paragraph
            above does not - see showRouteDetail. For a stall the two are
            the same point in different words, and reading both one under
            the other is worse than reading either. */}
        {showRouteDetail(reason) && detail && detail.trim() !== "" && (
          <p className="dead-end-text trip-failed-detail">{detail}</p>
        )}

        {retried && canRetry(reason) && <p className="dead-end-text trip-failed-detail">{t.trip.failed.alreadyRetried}</p>}

        <div className="dead-end-actions">
          {retryable && (
            <button type="button" onClick={onRetry} disabled={retrying} className="font-ui btn-primary">
              {retrying ? t.trip.failed.retrying : t.trip.failed.retry}
            </button>
          )}
          {recheckable && (
            <button
              type="button"
              onClick={onRecheck}
                className={retryable ? "font-ui dead-end-link" : "font-ui btn-primary"}
            >
              {t.trip.failed.recheck}
            </button>
          )}
          <Link
            href={`/${suffix}`}
            className={retryable || recheckable ? "font-ui dead-end-link" : "font-ui btn-primary"}
          >
            {t.trip.failed.planNew}
          </Link>
        </div>

        {/* Under the button, not on it: what it costs belongs where
            somebody reads it before tapping, and a button with a price in
            its label is a button nobody reads. */}
        {retryable && <p className="trip-failed-note font-ui">{t.trip.failed.retryNote}</p>}

        {retryError && <p className="trip-failed-error font-ui">{retryError}</p>}

        {others.length > 0 && (
          <div className="trip-failed-others">
            <div className="font-ui trip-failed-others-label">{t.trip.failed.otherTrips}</div>
            <div className="trip-failed-others-list">
              {others.map((trip) => (
                <Link key={trip.jobId} href={`/trip/${trip.jobId}`} className="font-ui trip-failed-other">
                  {trip.destinations.join(" · ")}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
