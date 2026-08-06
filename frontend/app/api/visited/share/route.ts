// Returns (creating on first call) a stats share link. The tracker itself
// doesn't require signing in (see lib/localVisited.ts), so this route
// serves two callers:
//   - GET, signed in: the account owner's stable, server-issued token
//     (unchanged from before).
//   - POST, not signed in: the caller already minted its own token
//     client-side and just wants its snapshot stored/refreshed under it —
//     see lib/statsShare.ts's anonymous functions.
// A signed-in POST is treated the same as GET (ignores the body, uses the
// account's real list) so a signed-in caller never accidentally shares a
// stale local snapshot instead of their synced one.
// Reading the stats BEHIND a token (app/api/stats-share/[token]) is
// deliberately public and unauthenticated — that's the whole point of a
// shareable link — this route is just where the token itself is issued.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getOrCreateShareToken, saveAnonymousShareSnapshot } from "@/lib/statsShare";
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

  const token = typeof (body as Record<string, unknown>)?.token === "string" ? (body as { token: string }).token : "";
  const codes = Array.isArray((body as Record<string, unknown>)?.codes)
    ? ((body as { codes: unknown[] }).codes.filter((c): c is string => typeof c === "string"))
    : null;
  // A sane length cap on the token, not a format check — it's an opaque
  // client-generated ID, not something this route needs to parse.
  if (!token.trim() || token.length > 128 || !codes) {
    return NextResponse.json({ detail: "token and codes are required." }, { status: 400 });
  }

  await saveAnonymousShareSnapshot(redis, token, codes);
  return NextResponse.json({ token, url: `${getSiteUrl()}/compare-stats?a=${token}` });
}
