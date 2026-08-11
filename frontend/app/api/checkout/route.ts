// Creates a Stripe Checkout session for the subscription. Stripe collects
// payment details itself (this app never touches a card number) and the
// checkout.session.completed webhook (see app/api/stripe/webhook) is what
// actually grants paid access — the redirect back here is just where the
// traveler ends up, not a trust boundary. The email typed on the pricing
// page becomes both the Stripe customer's email and the key the webhook
// upserts user:<email> under, so it MUST match whatever email the traveler
// later requests a magic link with — the pricing page copy says this.

import { NextRequest, NextResponse } from "next/server";
import { getStripe, getSubscriptionPriceId } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/siteUrl";
import { getRedis } from "@/lib/redis";
import { recordFunnelEvent } from "@/lib/analytics";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let email: string;
  try {
    const body = await request.json();
    email = typeof body?.email === "string" ? body.email.trim() : "";
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ detail: "Enter a valid email address." }, { status: 400 });
  }

  let stripe;
  let priceId: string;
  try {
    stripe = getStripe();
    priceId = getSubscriptionPriceId();
  } catch {
    return NextResponse.json({ detail: "Subscriptions aren't configured on this deployment yet." }, { status: 500 });
  }

  const site = getSiteUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${site}/account?checkout=success`,
      cancel_url: `${site}/pricing?checkout=cancelled`,
      metadata: { email },
    });

    if (!session.url) {
      return NextResponse.json({ detail: "Couldn't start checkout. Try again." }, { status: 502 });
    }

    // Funnel visibility — best-effort, must never block a real checkout.
    try {
      await recordFunnelEvent(getRedis(), "checkout_started");
    } catch {
      // swallow
    }

    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ detail: "Couldn't start checkout. Try again." }, { status: 502 });
  }
}
