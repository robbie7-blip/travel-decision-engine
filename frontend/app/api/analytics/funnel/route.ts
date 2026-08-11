// The one funnel event that has to be recorded from the client rather than
// an existing server route — a pricing-page view has no server-side hook
// to piggyback on (pricing/page.tsx is a plain client component, nothing
// server-rendered runs when someone lands on it). Deliberately narrow: only
// "pricing_view" is accepted, not an arbitrary client-supplied event name,
// so this can't be turned into an open counter-increment-anything endpoint.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { recordFunnelEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (body?.type !== "pricing_view") {
    return NextResponse.json({ detail: "Unsupported event type." }, { status: 400 });
  }

  try {
    const redis = getRedis();
    await recordFunnelEvent(redis, "pricing_view");
  } catch {
    // Best-effort, same contract as every other recordEvent call site —
    // a missed pageview counter must never surface as a user-facing error.
  }

  return NextResponse.json({ ok: true });
}
