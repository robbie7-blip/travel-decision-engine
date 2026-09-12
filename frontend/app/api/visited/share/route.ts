// Returns (creating on first call) a stats share link. The tracker itself
// doesn't require signing in (see lib/localVisited.ts), so this route
// serves two callers:
//   - GET, signed in: the account owner's stable, server-issued token
//     (unchanged from before).
//   - POST, not signed in: the caller already minted its own token
//     client-side and just wants its snapshot stored/refreshed under it -
//     see lib/statsShare.ts's anonymous functions.
// A signed-in POST is treated the same as GET (ignores the body, uses the
// account's real list) so a signed-in caller never accidentally shares a
// stale local snapshot instead of their synced one.
// Reading the stats BEHIND a token (app/api/stats-share/[token]) is
// deliberately public and unauthenticated - that's the whole point of a
// shareable link - this route is just where the token itself is issued.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getOrCreateShareToken, isValidShareToken, saveAnonymousShareSnapshot } from "@/lib/statsShare";
import { sanitizeVisitedCodes } from "@/lib/visited";
import { checkRateLimit, getClientIp, VISITED_SHARE_RATE_LIMIT } from "@/lib/ratelimit";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) {
    return NextResponse.json({ detail: "Sign in to get a shareable link." }, { status: 401 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const token = await getOrCreateShareToken(redis, email);
  return NextResponse.json({ token, url: `${getSiteUrl()}/compare-stats?a=${token}` });
}

export async function POST(request: NextRequest) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  if (email) {
    const token = await getOrCreateShareToken(redis, email);
    return NextResponse.json({ token, url: `${getSiteUrl()}/compare-stats?a=${token}` });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const raw = body as Record<string, unknown> | null;

  // The token is CHECKED for shape now, not just length-capped. It becomes
  // a Redis key suffix, and it is the only access control on the snapshot
  // behind it - so a one-character token was both a key-injection surface
  // and a guessable capability. Both real issuers fit inside
  // isValidShareToken; see the note on it.
  if (!isValidShareToken(raw?.token)) {
    return NextResponse.json({ detail: "A valid share token is required." }, { status: 400 });
  }
  const token = raw.token;

  // The codes are reduced to real, deduplicated country codes before being
  // stored. `typeof c === "string"` was the only filter, with no cap on how
  // many entries or how long each one was, feeding JSON.stringify into a key
  // that lives for 400 days. computeVisitedStats discards anything
  // getCountry does not recognise anyway, so this costs nothing in
  // behaviour and bounds the stored value by the country list itself.
  if (!Array.isArray(raw?.codes)) {
    return NextResponse.json({ detail: "codes must be an array." }, { status: 400 });
  }
  const codes = sanitizeVisitedCodes(raw.codes);

  // Rate limited because this is the one write in the app that lets an
  // UNAUTHENTICATED caller choose its own Redis key. Validating the codes
  // bounds how big each snapshot can be; this bounds how many of them one
  // caller can create, each holding its key for 400 days. The allowance is
  // deliberately generous - the visited page POSTs here on every country
  // toggle once a link exists, so someone ticking off a long list makes a
  // long run of legitimate calls.
  const rateLimit = await checkRateLimit(redis, getClientIp(request), VISITED_SHARE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { detail: rateLimit.reason ?? "Too many share updates. Try again later." },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : {} }
    );
  }

  await saveAnonymousShareSnapshot(redis, token, codes);
  return NextResponse.json({ token, url: `${getSiteUrl()}/compare-stats?a=${token}` });
}
