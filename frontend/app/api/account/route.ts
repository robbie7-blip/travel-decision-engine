// Current account state for the signed-in visitor (if any) — plan, quota
// used this month, subscription status. Reads a plain browser cookie, so
// this can't be cached/shared across users the way a public GET normally
// could be; that's fine, it's always a same-origin fetch from the account
// page.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getUserRecord, getQuotaStatus, isPaidStatus } from "@/lib/account";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
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
  const plan = isPaidStatus(user?.subscriptionStatus ?? null) ? "paid" : "free";
  const quota = await getQuotaStatus(redis, email, plan);

  return NextResponse.json({
    signedIn: true,
    email,
    plan,
    subscriptionStatus: user?.subscriptionStatus ?? null,
    currentPeriodEnd: user?.currentPeriodEnd ?? null,
    quota: { used: quota.used, limit: quota.limit },
  });
}
