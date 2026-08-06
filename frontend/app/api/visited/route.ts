// Optional cross-device sync for the visited-countries tracker. The tracker
// itself is local-storage-first and needs no account at all (see
// lib/localVisited.ts + app/account/visited/page.tsx) — this route is only
// hit when someone chooses to sign in so their list follows them to another
// device too. Session-gated the same as /api/account since it's account
// state once someone opts in.

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
