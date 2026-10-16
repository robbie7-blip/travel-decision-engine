// The signed-in account's invite link and what it has earned, for the
// account page. Its own route rather than part of /api/account, which runs
// on every page's header: the code is made on first ask, and only the
// account page needs it.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { REFERRAL_MONTHLY_CAP, referralCodeFor, referralStats } from "@/lib/referral";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) return NextResponse.json({ detail: "Sign in first." }, { status: 401 });
  try {
    const redis = getRedis();
    const [code, stats] = await Promise.all([referralCodeFor(redis, email), referralStats(redis, email)]);
    return NextResponse.json(
      { link: `${getSiteUrl().replace(/\/$/, "")}/r/${code}`, joined: stats.joined, bonus: stats.bonus, monthlyCap: REFERRAL_MONTHLY_CAP },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ detail: "Invites are not available right now." }, { status: 503 });
  }
}
