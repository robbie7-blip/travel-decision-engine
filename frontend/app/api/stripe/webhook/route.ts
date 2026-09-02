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
import { linkStripeCustomerToEmail, getEmailForStripeCustomer, upsertUserRecord } from "@/lib/account";
import { recordFunnelEvent } from "@/lib/analytics";

export const runtime = "nodejs";

/** This subscription's period end - a single-price subscription (which is
 * all this app creates) always has exactly one item, so its period end IS
 * the subscription's period end for display purposes. */
function currentPeriodEndOf(subscription: Stripe.Subscription): number | null {
  return subscription.items.data[0]?.current_period_end ?? null;
}

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
  const redis = getRedis();
  const email = session.customer_details?.email ?? (session.metadata?.email as string | undefined);
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

  await upsertUserRecord(redis, email, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId ?? null,
    subscriptionStatus: status,
    currentPeriodEnd,
  });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const redis = getRedis();
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const email = await getEmailForStripeCustomer(redis, customerId);
  // No reverse-index entry yet (e.g. this event raced ahead of
  // checkout.session.completed) - nothing to update; the completed handler
  // will write the initial status shortly after.
  if (!email) return;

  await upsertUserRecord(redis, email, {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: currentPeriodEndOf(subscription),
  });
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
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
        // Funnel visibility (see lib/analytics.ts) - the actual conversion
        // event, not just a checkout attempt. Deliberately after the real
        // work above, not before: never counted if granting access itself
        // failed and this handler threw.
        await recordFunnelEvent(getRedis(), "checkout_completed").catch(() => {});
        break;
      case "customer.subscription.updated":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
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
