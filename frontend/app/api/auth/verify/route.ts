// The link a magic-link email points at.
//
// GET no longer consumes the token — it used to, but any automated system
// that fetches a link before a human clicks it (Resend's own click-tracking
// rewrite, Outlook "Safe Links", corporate mail security gateways, various
// antivirus link scanners) only needs to issue one GET to burn a single-use
// token, which meant a real click could fail with "invalid or expired"
// before the traveler ever saw the link. GET now just renders a page that
// auto-submits a POST via a tiny inline script (with a plain <button>
// fallback for the rare no-JS case) — the POST is what actually consumes
// the token and sets the session cookie. Automated fetchers essentially
// never execute JavaScript or submit forms, so they see this harmless
// intermediate page and nothing happens to the token; a real person's
// browser submits it near-instantly, so it still feels like one tap.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { consumeMagicLinkToken } from "@/lib/magicLink";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/session";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const site = getSiteUrl();

  if (!token) {
    return NextResponse.redirect(`${site}/account?error=missing_token`);
  }

  // Token isn't touched here at all — validity is only checked (and
  // consumed) by the POST below, once a real browser actually submits it.
  const safeToken = escapeHtmlAttr(token);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signing in…</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f1e2; color: #2b241c;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; }
    .brand { font-size: 20px; font-weight: 700; color: #1f6f8a; margin-bottom: 12px; }
    button { font-family: inherit; background: #1f6f8a; color: white; border: none; border-radius: 8px;
             padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="brand">decide</div>
    <p>Finishing sign-in…</p>
    <form id="f" method="POST" action="/api/auth/verify">
      <input type="hidden" name="token" value="${safeToken}" />
      <noscript><button type="submit">Click to finish signing in</button></noscript>
    </form>
  </div>
  <script>document.getElementById('f').submit();</script>
</body>
</html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: NextRequest) {
  const site = getSiteUrl();
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");

  if (typeof token !== "string" || !token) {
    return NextResponse.redirect(`${site}/account?error=missing_token`, { status: 303 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.redirect(`${site}/account?error=server`, { status: 303 });
  }

  const email = await consumeMagicLinkToken(redis, token);
  if (!email) {
    return NextResponse.redirect(`${site}/account?error=invalid_link`, { status: 303 });
  }

  const response = NextResponse.redirect(`${site}/account?signedIn=1`, { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
