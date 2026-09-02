// Protected by middleware.ts (matches /api/admin/:path*, same
// ADMIN_PASSWORD as the rest of /admin/*). Lets the site owner curate the
// /showcase gallery: add an already-generated trip by jobId, or remove one.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { loadJob } from "@/lib/loadJob";
import { jobKey, CURATED_JOB_TTL_SECONDS } from "@/lib/jobs";
import { MAX_SHOWCASE_ENTRIES, SHOWCASE_LIST_KEY, type ShowcaseTrip } from "@/lib/showcase";

export const runtime = "nodejs";

async function loadList(redis: ReturnType<typeof getRedis>): Promise<ShowcaseTrip[]> {
  const raw = await redis.lrange<string | ShowcaseTrip>(SHOWCASE_LIST_KEY, 0, -1);
  return raw.map((r) => (typeof r === "string" ? (JSON.parse(r) as ShowcaseTrip) : r));
}

// Rewrites the whole list rather than lrem/lset-ing a single value - Upstash
// auto-deserializes JSON-looking strings on read, so a value read back as an
// object won't byte-for-byte match the JSON string it was written as,
// which is what lrem needs. Fine at this scale (an admin-curated list, not
// a high-write structure).
async function saveList(redis: ReturnType<typeof getRedis>, trips: ShowcaseTrip[]): Promise<void> {
  await redis.del(SHOWCASE_LIST_KEY);
  if (trips.length > 0) {
    await redis.rpush(SHOWCASE_LIST_KEY, ...trips.map((t) => JSON.stringify(t)));
  }
}

function getRedisOrNull() {
  try {
    return getRedis();
  } catch {
    return null;
  }
}

export async function GET() {
  const redis = getRedisOrNull();
  if (!redis) {
    return NextResponse.json({ detail: "Job queue is not configured." }, { status: 500 });
  }
  const trips = await loadList(redis);
  return NextResponse.json({ trips: [...trips].reverse() }); // newest first
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const jobId = typeof (body as Record<string, unknown>)?.jobId === "string" ? (body as { jobId: string }).jobId.trim() : "";
  if (!jobId) {
    return NextResponse.json({ detail: "jobId is required." }, { status: 400 });
  }

  const job = await loadJob(jobId);
  if (!job) {
    return NextResponse.json({ detail: "No job found with that id (it may have expired)." }, { status: 404 });
  }
  if (job.status !== "done" || !job.result) {
    return NextResponse.json({ detail: `That job hasn't finished successfully (status: ${job.status}).` }, { status: 400 });
  }

  const redis = getRedisOrNull();
  if (!redis) {
    return NextResponse.json({ detail: "Job queue is not configured." }, { status: 500 });
  }

  const existing = await loadList(redis);
  if (existing.some((t) => t.jobId === job.id)) {
    return NextResponse.json({ detail: "That trip is already in the showcase." }, { status: 400 });
  }

  const entry: ShowcaseTrip = { jobId: job.id, destinations: job.brief.destinations, addedAt: Date.now() };
  const updated = [...existing, entry].slice(-MAX_SHOWCASE_ENTRIES);
  await saveList(redis, updated);
  // The whole point of curating this trip is that it keeps showing up -
  // don't let it quietly drop off the gallery on the normal 30-day job TTL.
  await redis.expire(jobKey(job.id), CURATED_JOB_TTL_SECONDS);

  return NextResponse.json({ trips: [...updated].reverse() });
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const jobId = typeof (body as Record<string, unknown>)?.jobId === "string" ? (body as { jobId: string }).jobId.trim() : "";
  if (!jobId) {
    return NextResponse.json({ detail: "jobId is required." }, { status: 400 });
  }

  const redis = getRedisOrNull();
  if (!redis) {
    return NextResponse.json({ detail: "Job queue is not configured." }, { status: 500 });
  }

  const existing = await loadList(redis);
  const updated = existing.filter((t) => t.jobId !== jobId);
  await saveList(redis, updated);

  return NextResponse.json({ trips: [...updated].reverse() });
}
