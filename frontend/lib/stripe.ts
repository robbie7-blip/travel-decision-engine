// Stripe client - lazily constructed (like getRedis in redis.ts) so a build
// without STRIPE_SECRET_KEY set doesn't crash at import time, only when a
// route that actually needs it runs.

import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set - subscriptions are unconfigured.");
  }
  client = new Stripe(key);
  return client;
}

export type CheckoutPlan = "annual" | "trip_pass";

/** The Stripe Price behind each thing the pricing page sells, created in
 * the Stripe dashboard (Product catalog) and set on Vercel:
 *   STRIPE_ANNUAL_PRICE_ID     the yearly Traveller plan (recurring, yearly)
 *   STRIPE_TRIP_PASS_PRICE_ID  the Trip Pass (one-off)
 * Never falls back to STRIPE_PRICE_ID, the old monthly plan: selling that
 * under the yearly plan's name would charge people the wrong amount. */
export function getPlanPriceId(plan: CheckoutPlan): string {
  const priceId = plan === "annual" ? process.env.STRIPE_ANNUAL_PRICE_ID : process.env.STRIPE_TRIP_PASS_PRICE_ID;
  if (!priceId) throw new Error(`The Stripe price for ${plan} is not set.`);
  return priceId;
}
