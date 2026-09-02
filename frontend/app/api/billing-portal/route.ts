// Redirects a signed-in Pro traveler to Stripe's hosted Customer Portal -
// the self-service "manage/cancel my subscription" flow this app didn't
// have before (see /terms's "Subscriptions and billing" section, which
// used to say cancellation was email-only). Stripe's portal handles
// cancellation, payment-method updates, and invoice history itself; this
// route's only job is proving the caller is actually the signed-in owner
// of a real Stripe customer before handing out a portal session for it.
//
// Requires the Customer Portal to be turned on once in the Stripe
// dashboard (Settings -> Billing -> Customer portal) - same one-time
// dashboard setup as the Product/Price and webhook, not something this
// route can configure itself.

import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/siteUrl";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getUserRecord } from "@/lib/account";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) {
    return NextResponse.json({ detail: "Sign in first." }, { status: 401 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const user = await getUserRecord(redis, email);
  if (!user?.stripeCustomerId) {
    // Signed in, but never actually subscribed (or the webhook hasn't
    // linked the customer yet) - nothing for the portal to manage.
    return NextResponse.json({ detail: "No subscription found for this account." }, { status: 404 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ detail: "Subscriptions aren't configured on this deployment yet." }, { status: 500 });
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getSiteUrl()}/account`,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch {
    // Most common real-world cause: the Customer Portal hasn't been
    // enabled yet in the Stripe dashboard for this account/mode - a
    // config gap, not something to leak as a raw provider error.
    return NextResponse.json(
      { detail: "Couldn't open the billing portal. Try again, or contact support." },
      { status: 502 }
    );
  }
}
