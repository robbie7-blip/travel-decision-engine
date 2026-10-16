// An invite link: yourdecide.com/r/<code>. Keeps the code in a cookie for
// 30 days and goes to the homepage; the friend's first signed-in trip
// settles it (lib/referral.ts, app/api/generate). An unknown code still
// goes to the homepage, just without the cookie.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { REFERRAL_COOKIE_MAX_AGE, REFERRAL_COOKIE_NAME, isReferralCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lang = request.nextUrl.searchParams.get("lang") === "bg" ? "?lang=bg" : "";
  const response = NextResponse.redirect(new URL(`/${lang}`, request.url), 307);
  response.headers.set("X-Robots-Tag", "noindex");
  if (!isReferralCode(code)) return response;
  try {
    const inviter = await getRedis().get<string>(`ref:code:${code}`);
    if (!inviter) return response;
  } catch {
    return response;
  }
  response.cookies.set(REFERRAL_COOKIE_NAME, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
  });
  return response;
}
