// Signs in with the six-digit code from the sign-in email, in the tab the
// visitor is actually using. See lib/signInCode.ts for why this exists
// beside the link, and for the limits that make a six-digit code safe.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientIp, SIGNIN_CODE_RATE_LIMIT } from "@/lib/ratelimit";
import { createSessionCookieValue, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { verifySignInCode } from "@/lib/signInCode";
import { getSiteUrl } from "@/lib/siteUrl";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || email.length > 254 || !email.includes("@")) {
    return NextResponse.json({ detail: "Enter the email address you asked for the code with." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured (accounts are not set up)." }, { status: 500 });
  }

  const limit = await checkRateLimit(redis, getClientIp(request), SIGNIN_CODE_RATE_LIMIT);
  if (!limit.allowed) {
    const minutes = Math.ceil((limit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json({ code: "rate_limited", detail: `Too many tries. Try again in ~${minutes} minute(s).` }, { status: 429 });
  }

  const result = await verifySignInCode(redis, email, body?.code);
  if (!result.ok) {
    // The reason goes back as a code so the page can say it in the
    // reader's language; none of them says whether the address has an
    // account, because there is no such thing as "no account" here - any
    // address that asked for a code has one.
    return NextResponse.json({ code: result.reason, attemptsLeft: result.attemptsLeft }, { status: 400 });
  }

  let cookieValue: string;
  try {
    cookieValue = createSessionCookieValue(result.email);
  } catch (e) {
    console.error("[verify-code] createSessionCookieValue threw:", e);
    return NextResponse.json({ detail: "Server is misconfigured (accounts are not set up)." }, { status: 500 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, sessionCookieOptions());
  return response;
}
