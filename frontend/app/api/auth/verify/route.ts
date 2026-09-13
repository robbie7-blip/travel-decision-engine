// The link a magic-link email points at.
//
// GET no longer consumes the token - it used to, but any automated system
// that fetches a link before a human clicks it (Resend's own click-tracking
// rewrite, Outlook "Safe Links", corporate mail security gateways, various
// antivirus link scanners) only needs to issue one GET to burn a single-use
// token, which meant a real click could fail with "invalid or expired"
// before the traveler ever saw the link. GET now just renders a page that
// completes sign-in via a fetch() POST - the POST is what actually
// consumes the token and sets the session cookie. Automated fetchers
// essentially never execute JavaScript, so they see this harmless
// intermediate page and nothing happens to the token; a real person's
// browser completes it within milliseconds, so it still feels like one tap.
//
// fetch()-driven, not a raw auto-submitted <form> - confirmed in production
// (Safari, desktop, no extensions/cache involved) that a form.submit() fired
// from an inline <script> right as the page loads could leave the tab on a
// blank page with the navigation never completing (no status, no response
// headers at all in the network inspector - the request never finished).
// Handing control to the browser's own navigation timing right as the
// document is still settling is exactly the kind of thing that varies by
// browser; driving it with fetch() instead means the intermediate page
// stays fully loaded and in control throughout, and *this* script decides
// when to navigate away, once it actually has a real response in hand - no
// dependency on how any particular browser sequences a same-tick form
// submission against its own page-load lifecycle. A visible fallback
// button still appears (via a short timeout, or immediately for the no-JS
// case) so nobody is ever stuck looking at a page that silently never
// resolves.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { consumeMagicLinkToken } from "@/lib/magicLink";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/session";
import { getSiteUrl } from "@/lib/siteUrl";
import { isMagicLinkTokenShape, renderVerifyPage } from "@/lib/authVerifyPage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const site = getSiteUrl();

  if (!token) {
    // Logged so we can tell this apart from the POST hitting the same
    // ?error=missing_token redirect below - if this is the branch firing,
    // the email link itself arrived at this route with no ?token= at all
    // (link-wrapping/click-tracking rewrite, a copy-paste that dropped the
    // query string, etc.), which is a completely different bug from the
    // POST losing a token it *did* receive.
    console.error("[verify][GET] no token in query string. Full URL:", request.url);
    return NextResponse.redirect(`${site}/account?error=missing_token`);
  }

  // Refused before anything is rendered.
  //
  // This page embeds the token in an inline <script>, and that embedding was
  // built with JSON.stringify alone - which escapes quotes and backslashes
  // and leaves `</script` untouched. A token of
  // "</script><script>...</script>" therefore closed the real script element
  // early and ran as its own script on this origin: reflected XSS on the
  // authentication endpoint, confirmed in Chromium rather than argued about.
  // See lib/authVerifyPage.ts.
  //
  // The escaping there is correct now, so this check is the second lock on
  // the same door. It costs nothing and it is the one that kills the class:
  // a token that cannot have come from generateMagicLinkToken is not a
  // token, so there is nothing to lose by refusing it here rather than
  // discovering it is unknown one Redis round-trip later.
  if (!isMagicLinkTokenShape(token)) {
    console.error(
      "[verify][GET] token does not have the shape generateMagicLinkToken produces - refusing to render. Length:",
      token.length
    );
    return NextResponse.redirect(`${site}/account?error=invalid_link`);
  }

  // Token is not otherwise touched here - validity is only checked (and
  // consumed) by the POST below, once the browser actually issues it.
  const html = renderVerifyPage(token);

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Both submission paths - the fetch() call above and the <noscript>/fallback
// <form> - send the token as application/x-www-form-urlencoded: that's
// URLSearchParams's serialization for the fetch body, and it's also a plain
// HTML <form>'s default enctype (multipart/form-data is opt-in, not the
// default). request.formData() is supposed to handle both per the Fetch
// spec, but in production this was silently failing on the urlencoded case -
// the request reached this handler (proven by landing on this route's own
// ?error=missing_token, not a blank page or a different error), yet the
// token never came out of form.get("token"), which only happens if
// formData() threw and got swallowed by the .catch(() => null) that used to
// be here, or returned an empty FormData. Parsing urlencoded bodies by hand
// with URLSearchParams sidesteps whatever gap that was, and is at least as
// reliable since it's the same string format either submission path sends.
async function extractToken(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const value = form.get("token");
      return typeof value === "string" && value ? value : null;
    }
    const raw = await request.text();
    const value = new URLSearchParams(raw).get("token");
    if (!value) {
      // Logged (not just the generic redirect) so a Vercel Runtime Log
      // capture actually tells us which of two very different bugs this is:
      // content-type wrong/missing entirely (client-side send bug) vs.
      // content-type looks right but the body came through empty/mangled
      // (something between the browser and this function stripped it -
      // could be a CDN/edge layer, could be Vercel's own deployment
      // protection intercepting the POST). Body is logged truncated since
      // it's expected to just be "token=<opaque>" - nothing sensitive
      // beyond the token itself, which is already single-use and about to
      // be invalidated by this same request either way.
      console.error(
        "[verify][POST] token not found in body. content-type:",
        JSON.stringify(contentType),
        "raw body (first 200 chars):",
        JSON.stringify(raw.slice(0, 200)),
        "raw body length:",
        raw.length
      );
    }
    return value || null;
  } catch (e) {
    console.error("[verify][POST] extractToken threw:", e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const site = getSiteUrl();
  const token = await extractToken(request);

  if (!token) {
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

  // Token is already consumed above by this point - a throw here (e.g.
  // SESSION_SECRET missing) used to bubble up as an unhandled 500 with no
  // redirect at all, which the fetch() caller then (mis)treated as success
  // and navigated to res.url with no query string, landing on this same
  // route's GET-with-no-token branch and showing ?error=missing_token -
  // completely hiding that the real problem was server config, not the
  // token. Catching it here and logging explicitly means the real cause
  // shows up in Vercel's logs instead of a wild goose chase, and the
  // fetch() caller's res.ok check (see the GET handler's inline script)
  // now shows the visible fallback button instead of a silent bad redirect.
  let cookieValue: string;
  try {
    cookieValue = createSessionCookieValue(email);
  } catch (e) {
    console.error("[verify][POST] createSessionCookieValue threw (token already consumed for", email, "):", e);
    return NextResponse.redirect(`${site}/account?error=server`, { status: 303 });
  }

  const response = NextResponse.redirect(`${site}/account?signedIn=1`, { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
