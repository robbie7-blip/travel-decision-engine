// The homepage's counters: an event name from a fixed list, incremented.
// See lib/homeEvents.ts for what is counted and why nothing else is sent.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { recordHomeEvent } from "@/lib/analytics";
import { isHomeEventType } from "@/lib/homeEvents";
import { checkRateLimit, getClientIp, HOME_ANALYTICS_RATE_LIMIT } from "@/lib/ratelimit";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Another site cannot run our numbers up from its visitors' browsers.
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const type: unknown = body?.type;
  if (!isHomeEventType(type)) {
    return NextResponse.json({ detail: "Unsupported event type." }, { status: 400 });
  }

  try {
    const redis = getRedis();
    // The IP is used for the rate limit's window and nothing else; the
    // counter itself stores only the event name.
    const limit = await checkRateLimit(redis, getClientIp(request), HOME_ANALYTICS_RATE_LIMIT);
    if (!limit.allowed) return NextResponse.json({ ok: false }, { status: 429 });
    await recordHomeEvent(redis, type);
  } catch {
    // Best-effort, same contract as every other counter: a missed count
    // must never surface as an error to anyone.
  }

  return NextResponse.json({ ok: true });
}
