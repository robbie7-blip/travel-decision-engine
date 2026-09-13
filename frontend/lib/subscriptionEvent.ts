// Whether a Stripe subscription event may change a user's paid access.
//
// The webhook is the ONLY place that grants or revokes paid access, and
// handleSubscriptionChange applied every event it received, verbatim, with
// no check that the event was about the subscription the user actually has
// or that it was newer than what had already been applied. Two ways that
// goes wrong, both reachable, both about money:
//
// THE STALE CUSTOMER. /api/checkout creates a session with `customer_email`
// and no `customer`, so EVERY checkout mints a fresh Stripe customer. A
// traveller who cancels and later resubscribes therefore has two: cus_A
// (dead) and cus_B (live). The reverse index stripeCustomer:cus_A -> email
// is written once at checkout and never removed - it has no TTL - so any
// later event about the DEAD subscription still resolves to that email, and
// `customer.subscription.deleted` for cus_A wrote "canceled" over a live,
// paid cus_B. They paid and lost access, and nothing would have put it back,
// because no other code path ever re-reads the subscription.
//
// THE RETRIED EVENT. Stripe does not promise to deliver events in the order
// it generated them, and this route makes that concrete on its own: it
// returns 500 on a Redis hiccup specifically so Stripe will retry the event
// later, on a backoff, by which time subsequent events have been delivered
// and applied. A retried "updated (active)" landing after a "deleted"
// re-grants paid access permanently.
//
// Both are decided here rather than in the route because no route handler
// in this app has a test - driving one means standing up Next's request
// plumbing and a Redis client that reads process.env - and "who gets paid
// access" is the last logic in the app that should be reasoned about only
// by reading it. Same shape as lib/refineSource.ts.
//
// Run: npm run test:subscription-event

import type { UserRecord } from "./account";

/** The parts of a Stripe subscription event this decision needs, lifted out
 * of the SDK types so a test can build one without a Stripe namespace. */
export interface SubscriptionEventFacts {
  customerId: string;
  subscriptionId: string;
  /** Stripe's own status string - see isPaidStatus in lib/account.ts. */
  status: string;
  currentPeriodEnd: number | null;
  /** The EVENT's `created`, epoch seconds - not the subscription's. This is
   * when Stripe generated the notification, which is the only ordering
   * information a webhook receives. */
  createdAt: number;
}

export type SubscriptionDecision =
  | { apply: true; fields: Partial<Omit<UserRecord, "email">> }
  | { apply: false; reason: string };

/** What to write for this event, or why to ignore it.
 *
 * `record` is the user's current record, or null when the reverse index
 * resolved an email that has no record yet. Null applies: the index is only
 * written at checkout, so an email in it did check out, and writing the
 * record here (customer id included, which handleSubscriptionChange never
 * did) is how it becomes coherent rather than a status with no subscription
 * attached to it. */
export function decideSubscriptionUpdate(
  record: UserRecord | null,
  event: SubscriptionEventFacts
): SubscriptionDecision {
  // A malformed event cannot be reasoned about, and the failure mode of
  // guessing is writing a status against the wrong identity.
  if (!event.customerId.trim() || !event.subscriptionId.trim()) {
    return { apply: false, reason: "the event names no customer or no subscription" };
  }
  if (!Number.isFinite(event.createdAt)) {
    return { apply: false, reason: "the event has no usable timestamp" };
  }

  const fields: Partial<Omit<UserRecord, "email">> = {
    stripeCustomerId: event.customerId,
    stripeSubscriptionId: event.subscriptionId,
    subscriptionStatus: event.status,
    currentPeriodEnd: event.currentPeriodEnd,
    lastEventAt: event.createdAt,
  };

  if (record === null) return { apply: true, fields };

  // The stale customer. Checked before the subscription id because it is
  // the case that actually happens: a resubscription produces a whole new
  // customer, not merely a new subscription under the old one.
  if (record.stripeCustomerId !== null && record.stripeCustomerId !== event.customerId) {
    return {
      apply: false,
      reason: `the event is about customer ${event.customerId} but this account is on ${record.stripeCustomerId}`,
    };
  }

  // The stale subscription. Only when the record HAS one: a record with a
  // customer but no subscription id is a checkout that completed before
  // its subscription existed, and this event is its first real news.
  if (record.stripeSubscriptionId !== null && record.stripeSubscriptionId !== event.subscriptionId) {
    return {
      apply: false,
      reason: `the event is about subscription ${event.subscriptionId} but this account is on ${record.stripeSubscriptionId}`,
    };
  }

  // Strictly older, not older-or-equal: two Stripe events can carry the
  // same `created` second, and refusing an equal one would drop a real
  // update. Within one second, last write wins.
  if (record.lastEventAt !== null && event.createdAt < record.lastEventAt) {
    return {
      apply: false,
      reason: `the event is from ${event.createdAt} and this account has already applied ${record.lastEventAt}`,
    };
  }

  return { apply: true, fields };
}

/** The clock value a checkout should write.
 *
 * checkout.session.completed is exempt from the staleness rules above - a
 * new checkout is exactly how a new customer and subscription legitimately
 * replace the old ones, so refusing it would break resubscribing. It re-reads
 * the subscription from the Stripe API rather than trusting the event
 * payload, so what it writes is current regardless of the event's age.
 *
 * Its CLOCK still must not go backwards, though. A retried checkout event
 * from before the newest applied subscription event would otherwise lower
 * lastEventAt and reopen the window this whole file exists to close. */
export function advancedEventClock(record: UserRecord | null, eventCreatedAt: number): number {
  const previous = record?.lastEventAt ?? 0;
  if (!Number.isFinite(eventCreatedAt)) return previous;
  return Math.max(previous, eventCreatedAt);
}
