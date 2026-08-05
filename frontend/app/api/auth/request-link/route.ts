// Sends a magic sign-in link to an email. No account pre-creation step —
// the first successful click on the link IS the account (see account.ts:
// a user record only exists once something writes to it, which happens at
// Stripe checkout, not here). Signing in with no subscription just gets you
// the free-tier quota tracked against that email going forward.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientIp, AUTH_RATE_LIMIT } from "@/lib/ratelimit";
import { generateMagicLinkToken, storeMagicLinkToken } from "@/lib/magicLink";
import { sendMagicLinkEmail, EmailNotConfiguredError } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";

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

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured (accounts are not set up)." }, { status: 500 });
  }

  const rateLimit = await checkRateLimit(redis, getClientIp(request), AUTH_RATE_LIMIT);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many sign-in attempts. Try again in ~${minutes} minute(s).` },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined }
    );
  }

  const token = generateMagicLinkToken();
  await storeMagicLinkToken(redis, token, email);
  const verifyUrl = `${getSiteUrl()}/api/auth/verify?token=${token}`;

  try {
    await sendMagicLinkEmail(email, verifyUrl);
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { detail: "Sign-in email isn't configured on this deployment yet." },
        { status: 500 }
      );
    }
    return NextResponse.json({ detail: "Couldn't send the sign-in email. Try again shortly." }, { status: 502 });
  }

  // Deliberately the same generic message regardless of whether this email
  // has ever signed in before — nothing here should let a client
  // distinguish "known" from "unknown" addresses.
  return NextResponse.json({ ok: true, detail: "Check your email for a sign-in link." });
}
