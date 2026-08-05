// Signed-in visitor's visited-countries list + stats. Requires the same
// session cookie as /api/account — there's no anonymous/local-only mode
// here (unlike, say, RecentTrips, which is fine being local-only since it
// has no cross-device value; a visited list is exactly the kind of thing
// someone expects to follow them across devices, which is what an account
// is for).

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getVisitedCodes, setVisited, computeVisitedStats } from "@/lib/visited";

export const runtime = "nodejs";

function requireEmail(request: NextRequest): string | null {
  return verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function GET(request: NextRequest) {
  const email = requireEmail(request);
  if (!email) {
    return NextResponse.json({ detail: "Sign in to track visited places." }, { status: 401 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const codes = await getVisitedCodes(redis, email);
  return NextResponse.json({ codes, stats: computeVisitedStats(codes) });
}

export async function POST(request: NextRequest) {
  const email = requireEmail(request);
  if (!email) {
    return NextResponse.json({ detail: "Sign in to track visited places." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const code = typeof (body as Record<string, unknown>)?.code === "string" ? (body as { code: string }).code : "";
  const visited = Boolean((body as Record<string, unknown>)?.visited);
  if (!code.trim()) {
    return NextResponse.json({ detail: "code is required." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  await setVisited(redis, email, code, visited);
  const codes = await getVisitedCodes(redis, email);
  return NextResponse.json({ codes, stats: computeVisitedStats(codes) });
}
