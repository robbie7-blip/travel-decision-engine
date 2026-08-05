// The link a magic-link email points at. A plain GET (not POST) since it's
// meant to be clicked directly from an email client, not fetched by JS.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { consumeMagicLinkToken } from "@/lib/magicLink";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/session";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const site = getSiteUrl();

  if (!token) {
    return NextResponse.redirect(`${site}/account?error=missing_token`);
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.redirect(`${site}/account?error=server`);
  }

  const email = await consumeMagicLinkToken(redis, token);
  if (!email) {
    return NextResponse.redirect(`${site}/account?error=invalid_link`);
  }

  const response = NextResponse.redirect(`${site}/account?signedIn=1`);
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
