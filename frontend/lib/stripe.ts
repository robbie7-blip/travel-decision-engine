// Stripe client — lazily constructed (like getRedis in redis.ts) so a build
// without STRIPE_SECRET_KEY set doesn't crash at import time, only when a
// route that actually needs it runs.

import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set — subscriptions are unconfigured.");
  }
  client = new Stripe(key);
  return client;
}

/** The recurring Price ID for the paid plan — created once in the Stripe
 * dashboard (Product catalog -> add a recurring price) and referenced here
 * rather than constructed in code, so pricing changes don't need a deploy. */
export function getSubscriptionPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID is not set — subscriptions are unconfigured.");
  }
  return priceId;
}
