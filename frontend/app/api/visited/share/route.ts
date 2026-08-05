// Returns (creating on first call) the signed-in visitor's stable stats
// share link — session-gated the same as /api/visited, since only the
// account owner should be able to mint or discover their own token.
// Reading the stats BEHIND a token (app/api/stats-share/[token]) is
// deliberately public and unauthenticated — that's the whole point of a
// shareable link — this route is just where the token itself is issued.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getOrCreateShareToken } from "@/lib/statsShare";
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
