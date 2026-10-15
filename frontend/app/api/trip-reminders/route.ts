// The evening-before email's switch (lib/dayAhead.ts), for one trip.
//
// GET  ?jobId=   whether this visitor can turn it on (signed in, and the
//                trip is theirs), and whether it is on.
// POST {jobId, on}
//
// "Theirs" is Job.ownerEmail, set from the session when the trip was
// made. Opening someone's shared trip never offers the switch, so nobody
// can sign a stranger's inbox up to anything.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, ttlForJob, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";
import { dayAheadKey } from "@/lib/dayAhead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function ownedJob(request: NextRequest, jobId: string) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email || !jobId || jobId.length > 100) return null;
  const redis = getRedis();
  const job = readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
  if (!job || job.status !== "done" || !job.result) return null;
  if (job.ownerEmail?.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return { redis, job };
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  try {
    const owned = await ownedJob(request, jobId);
    if (!owned) return NextResponse.json({ available: false, on: false }, { headers: NO_STORE });
    const on = (await owned.redis.get(dayAheadKey(jobId))) !== null;
    return NextResponse.json({ available: true, on }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false, on: false }, { headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  let body: { jobId?: unknown; on?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (typeof body.on !== "boolean") return NextResponse.json({ detail: "on must be true or false." }, { status: 400 });
  const owned = await ownedJob(request, jobId).catch(() => null);
  if (!owned) return NextResponse.json({ detail: "Only the account that planned this trip can do that." }, { status: 403 });
  if (body.on) await owned.redis.set(dayAheadKey(jobId), "1", { ex: ttlForJob(owned.job) });
  else await owned.redis.del(dayAheadKey(jobId));
  return NextResponse.json({ available: true, on: body.on }, { headers: NO_STORE });
}
