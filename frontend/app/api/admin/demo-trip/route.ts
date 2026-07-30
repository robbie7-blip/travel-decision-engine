// Protected by middleware.ts (matches /api/admin/:path*, same
// ADMIN_PASSWORD as the rest of /admin/*). Lets the site owner point the
// homepage's "see a real example" link at any real, already-generated
// trip — see lib/demoTrip.ts for why this is admin-set rather than
// fabricated or hardcoded.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { loadJob } from "@/lib/loadJob";
import { DEMO_TRIP_KEY, type DemoTrip } from "@/lib/demoTrip";

export const runtime = "nodejs";

export async function GET() {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Job queue is not configured." }, { status: 500 });
  }

  const raw = await redis.get<string | DemoTrip>(DEMO_TRIP_KEY);
  if (!raw) return NextResponse.json({ demo: null });
  const demo = typeof raw === "string" ? (JSON.parse(raw) as DemoTrip) : raw;
  return NextResponse.json({ demo });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const jobId = typeof (body as Record<string, unknown>)?.jobId === "string" ? (body as { jobId: string }).jobId : "";
  if (!jobId.trim()) {
    return NextResponse.json({ detail: "jobId is required." }, { status: 400 });
  }

  const job = await loadJob(jobId.trim());
  if (!job) {
    return NextResponse.json({ detail: "No job found with that id (it may have expired)." }, { status: 404 });
  }
  if (job.status !== "done" || !job.result) {
    return NextResponse.json({ detail: `That job hasn't finished successfully (status: ${job.status}).` }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Job queue is not configured." }, { status: 500 });
  }

  const demo: DemoTrip = { jobId: job.id, destinations: job.brief.destinations, setAt: Date.now() };
  await redis.set(DEMO_TRIP_KEY, JSON.stringify(demo));
  return NextResponse.json({ demo });
}

export async function DELETE() {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Job queue is not configured." }, { status: 500 });
  }
  await redis.del(DEMO_TRIP_KEY);
  return NextResponse.json({ demo: null });
}
