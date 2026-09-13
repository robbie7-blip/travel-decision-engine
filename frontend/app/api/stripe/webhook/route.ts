// Note: this Stripe API version keeps current_period_end on each
// subscription ITEM, not on the subscription object itself (older API
// versions had it top-level) - see currentPeriodEndOf below.
//
// Stripe webhook - the ONLY place that grants or revokes paid access.
// Everything else (checkout route, account page) just reads what this has
// already written to Redis. Verifies the signature against the raw request
// body (must read via request.text(), never request.json() first, or the
// signature check fails on the re-serialized bytes).
//
// Configure in the Stripe dashboard: Developers -> Webhooks -> add endpoint
// -> {SITE_URL}/api/stripe/webhook, listening for at least:
// checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getRedis } from "@/lib/redis";
import { getStripe } from "@/lib/stripe";
import {
  linkStripeCustomerToEmail,
  getEmailForStripeCustomer,
  getUserRecord,
  upsertUserRecord,
} from "@/lib/account";
import { advancedEventClock, decideSubscriptionUpdate } from "@/lib/subscriptionEvent";
import { recordFunnelEvent } from "@/lib/analytics";

export const runtime = "nodejs";

/** This subscription's period end - a single-price subscription (which is
 * all this app creates) always has exactly one item, so its period end IS
 * the subscription's period end for display purposes. */
function currentPeriodEndOf(subscription: Stripe.Subscription): number | null {
  return subscription.items.data[0]?.current_period_end ?? null;
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  eventCreatedAt: number
) {
  const redis = getRedis();
  // metadata.email FIRST, and customer_details only as the fallback.
  //
  // These are two different things that happen to agree today. metadata is
  // the address the checkout route validated and put there (see
  // app/api/checkout/route.ts), and it is the address the pricing page's own
  // copy tells the traveller they must later request a magic link with - so
  // it is the key this account has to be filed under, because it is the key
  // sign-in will look it up by. customer_details.email is Stripe's own
  // record of the session.
  //
  // `customer_email` is passed at session creation, which Stripe presents
  // read-only, so the two match. Preferring the one the rest of the system
  // keys on means that staying true is not load-bearing: the alternative
  // failure is silent and expensive - the charge succeeds, paid access is
  // granted to an address nobody signs in with, and the traveller sees a
  // free account with the money gone.
  const email = (session.metadata?.email as string | undefined) ?? session.customer_details?.email;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!email || !customerId) return;

  await linkStripeCustomerToEmail(redis, customerId, email);

  let status: string | null = null;
  let currentPeriodEnd: number | null = null;
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    status = subscription.status;
    currentPeriodEnd = currentPeriodEndOf(subscription);
  }

  // Exempt from the staleness rules in lib/subscriptionEvent.ts, on
  // purpose: a new checkout is exactly how a new customer and subscription
  // legitimately replace the old ones, so refusing it would break
  // resubscribing. It is safe to be exempt because the status above was
  // RETRIEVED FROM THE API a moment ago rather than read off the event
  // payload, so it is current whatever the event's age.
  //
  // The clock is a separate question and must only ever move forwards - a
  // retried checkout event from before the newest applied subscription
  // event would otherwise lower it and reopen the window.
  await upsertUserRecord(redis, email, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId ?? null,
    subscriptionStatus: status,
    currentPeriodEnd,
    lastEventAt: advancedEventClock(await getUserRecord(redis, email), eventCreatedAt),
  });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, eventCreatedAt: number) {
  const redis = getRedis();
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const email = await getEmailForStripeCustomer(redis, customerId);
  // No reverse-index entry yet (e.g. this event raced ahead of
  // checkout.session.completed) - nothing to update; the completed handler
  // will write the initial status shortly after.
  if (!email) return;

  // Whether this event may touch this account at all. It used to be
  // applied unconditionally, which meant an event about a subscription the
  // traveller had already replaced could revoke the one they were paying
  // for, and a retried event could re-grant one they had cancelled. See
  // lib/subscriptionEvent.ts for both, and why the decision lives there
  // rather than in this route.
  const decision = decideSubscriptionUpdate(await getUserRecord(redis, email), {
    customerId,
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: currentPeriodEndOf(subscription),
    createdAt: eventCreatedAt,
  });
  if (!decision.apply) {
    // Logged rather than silent. An ignored access-control event is
    // exactly the thing somebody will need to find later, and Stripe's own
    // dashboard shows it delivered successfully - which it was.
    console.warn(
      `[stripe] ignoring ${subscription.status} for ${subscription.id}: ${decision.reason}`
    );
    return;
  }

  await upsertUserRecord(redis, email, decision.fields);
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ detail: "Webhook is not configured." }, { status: 500 });
  }

  const rawBody = await request.text();
  let stripe: Stripe;
  let event: Stripe.Event;
  try {
    stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ detail: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session, event.created);
        // Funnel visibility (see lib/analytics.ts) - the actual conversion
        // event, not just a checkout attempt. Deliberately after the real
        // work above, not before: never counted if granting access itself
        // failed and this handler threw.
        await recordFunnelEvent(getRedis(), "checkout_completed").catch(() => {});
        break;
      case "customer.subscription.updated":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription, event.created);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription, event.created);
        await recordFunnelEvent(getRedis(), "subscription_canceled").catch(() => {});
        break;
      default:
        // Every other event type is irrelevant to access control - Stripe
        // sends 200+ types and expects a 2xx for whichever ones a webhook
        // didn't ask about, so silently accepting the rest is correct, not
        // an oversight.
        break;
    }
  } catch {
    // Returning 500 makes Stripe retry this event later (it retries
    // non-2xx responses on a backoff schedule) - better than swallowing a
    // transient Redis/Stripe-API hiccup and silently never granting access.
    return NextResponse.json({ detail: "Failed to process event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
