// Public, unauthenticated read of the visited-stats behind a share token —
// same trust model as GET /api/job/[id] for a shareable trip link: the
// token IS the access control, no session needed. Deliberately never
// returns the email behind the token (see lib/statsShare.ts) — only the
// computed stats, which is all a comparison view needs.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getEmailForShareToken } from "@/lib/statsShare";
import { getVisitedCodes, computeVisitedStats } from "@/lib/visited";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const email = await getEmailForShareToken(redis, token);
  if (!email) {
    return NextResponse.json({ detail: "That share link isn't valid." }, { status: 404 });
  }

  const codes = await getVisitedCodes(redis, email);
  return NextResponse.json({ stats: computeVisitedStats(codes) });
}
