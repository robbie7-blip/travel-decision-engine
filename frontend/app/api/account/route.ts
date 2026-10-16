// Current account state for the signed-in visitor (if any) - plan, quota
// used this month, subscription status. Reads a plain browser cookie, so
// this can't be cached/shared across users the way a public GET normally
// could be; that's fine, it's always a same-origin fetch from the account
// page.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import {
  renewSessionCookieValue,
  sessionCookieOptions,
  verifySessionCookieValue,
  SESSION_COOKIE_NAME,
} from "@/lib/session";
import { getUserRecord, getQuotaStatus, resolvePlan } from "@/lib/account";

export const runtime = "nodejs";

/** Extends the session of whoever is using the site.
 *
 * THIS ROUTE, of the nine that read the cookie, because this is the one
 * that is already fetched from the header of every page (AccountControl,
 * in SiteHeader) - so "renew on use" lands here without a middleware
 * running on every request or nine routes each remembering to do it.
 *
 * Returns the response unchanged when there is nothing to renew, which is
 * nearly always: renewSessionCookieValue only hands back a value once a
 * day, and hands back null for a visitor who is not signed in at all. */
function withRenewedSession<T extends NextResponse>(response: T, cookie: string | undefined): T {
  const renewed = renewSessionCookieValue(cookie);
  if (renewed) response.cookies.set(SESSION_COOKIE_NAME, renewed, sessionCookieOptions());
  return response;
}

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const email = verifySessionCookieValue(cookie);
  if (!email) {
    return NextResponse.json({ signedIn: false });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const user = await getUserRecord(redis, email);
  const plan = resolvePlan(email, user?.subscriptionStatus ?? null);
  const quota = await getQuotaStatus(redis, email, plan);

  return withRenewedSession(
    NextResponse.json({
      signedIn: true,
      email,
      plan,
      subscriptionStatus: user?.subscriptionStatus ?? null,
      currentPeriodEnd: user?.currentPeriodEnd ?? null,
      quota: { used: quota.used, limit: quota.limit, bonus: quota.bonus },
      // Pro from a real Stripe subscription has something for the billing
      // portal to manage; Pro from the owner-override allowlist (see
      // lib/account.ts's PRO_OVERRIDE_EMAILS) doesn't - no stripeCustomerId
      // ever gets created for it. account/page.tsx uses this to decide
      // whether "Manage subscription" would have anything to do.
      hasStripeSubscription: Boolean(user?.stripeCustomerId),
    }),
    cookie
  );
}
