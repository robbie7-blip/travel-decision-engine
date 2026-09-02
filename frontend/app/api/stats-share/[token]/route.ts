// Public, unauthenticated read of the visited-stats behind a share token -
// same trust model as GET /api/job/[id] for a shareable trip link: the
// token IS the access control, no session needed. Deliberately never
// returns the email behind a signed-in token (see lib/statsShare.ts) - only
// the computed stats, which is all a comparison view needs.
//
// A token is either the signed-in kind (looked up to an email, whose live
// list is read fresh every time) or the anonymous kind (a stored snapshot,
// refreshed by the sharer's device on each toggle - see app/api/visited/
// share) - tried in that order since they're different Redis keys and a
// given token can only ever be one or the other.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getEmailForShareToken, getAnonymousShareSnapshot } from "@/lib/statsShare";
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
  if (email) {
    const codes = await getVisitedCodes(redis, email);
    return NextResponse.json({ stats: computeVisitedStats(codes) });
  }

  const snapshot = await getAnonymousShareSnapshot(redis, token);
  if (!snapshot) {
    return NextResponse.json({ detail: "That share link isn't valid." }, { status: 404 });
  }
  return NextResponse.json({ stats: computeVisitedStats(snapshot) });
}
