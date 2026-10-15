// Saves hand edits to a trip - removed lines, moved lines, new times - as
// a new revision, the way a pushback does, but with no model call: the
// edits are applied here (lib/tripEdits.ts) and the result is finished
// the moment it is written.
//
// A NEW id, not the same record changed in place: the trip may be a link
// someone shared, and the person who sent it should not find their plan
// rearranged by whoever opened it. The editor gets their own copy and is
// moved to it; everyone else keeps the original.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { JOB_TTL_SECONDS, SAVED_JOB_TTL_SECONDS, jobKey, ttlForJob, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { checkRateLimit, getClientIp, TRIP_EDIT_RATE_LIMIT } from "@/lib/ratelimit";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";
import { refineSource } from "@/lib/refineSource";
import { applyTripEdits, parseTripEdits } from "@/lib/tripEdits";
import { getDb } from "@/lib/db";
import { saveEditedTrip } from "@/lib/tripsQuery";
import { publicBrief } from "@/lib/publicBrief";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // A cross-site form could otherwise make a visitor's browser create
  // revisions in their name (and under their account).
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }
  const sourceJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!sourceJobId || sourceJobId.length > 100) {
    return NextResponse.json({ detail: "jobId is required." }, { status: 400 });
  }
  const parsedEdits = parseTripEdits(body.edits);
  if (!parsedEdits.ok) return NextResponse.json({ detail: parsedEdits.detail }, { status: 400 });

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured (job queue is not set up)." }, { status: 500 });
  }

  const rateLimit = await checkRateLimit(redis, getClientIp(request), TRIP_EDIT_RATE_LIMIT);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many requests - ${rateLimit.reason}. Try again in ~${minutes} minute(s).` },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined }
    );
  }

  // The same checks a pushback makes of its source: it exists, it is
  // finished, and its brief can still be read.
  const source = refineSource(await redis.get<string | Job>(jobKey(sourceJobId)));
  if (!source.ok) return NextResponse.json({ detail: source.detail }, { status: source.status });

  const applied = applyTripEdits(source.baseItinerary, parsedEdits.edits);
  if (!applied.ok) return NextResponse.json({ detail: applied.detail }, { status: 409 });

  const ownerEmail = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const ttlSeconds = ownerEmail ? SAVED_JOB_TTL_SECONDS : JOB_TTL_SECONDS;
  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = {
    id,
    status: "done",
    brief: source.brief,
    result: applied.itinerary,
    createdAt: now,
    updatedAt: now,
    ttlSeconds,
    replaces: sourceJobId,
    ...(ownerEmail ? { ownerEmail } : {}),
    ...(source.job.testMode ? { testMode: true } : {}),
  };
  await redis.set(jobKey(id), JSON.stringify(job), { ex: ttlSeconds });

  // The archive copy is best effort, like every write to it: a trip must
  // never fail to save because Postgres is down.
  const db = getDb();
  if (db) {
    try {
      await saveEditedTrip(db, {
        id,
        sourceId: sourceJobId,
        expiresAt: new Date(now + ttlForJob(job) * 1000),
        dayCount: applied.itinerary.days.length,
        itinerary: applied.itinerary,
        ownerEmail: ownerEmail ?? null,
      });
    } catch (e) {
      console.warn("[trip-edit] could not archive the edited trip:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }

  return NextResponse.json({ jobId: id, itinerary: applied.itinerary, brief: publicBrief(source.brief) });
}
