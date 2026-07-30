// Public, read-only: returns the current homepage demo trip, if one is set
// and its underlying job hasn't expired past JOB_TTL_SECONDS — never a
// fabricated example, see lib/demoTrip.ts. Separate from GET /api/job/[id]
// since the homepage only needs jobId + destinations, not the full
// itinerary, to render the "see a real example" link.

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { loadJob } from "@/lib/loadJob";
import { DEMO_TRIP_KEY, type DemoTrip } from "@/lib/demoTrip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ demo: null });
  }

  const raw = await redis.get<string | DemoTrip>(DEMO_TRIP_KEY);
  if (!raw) return NextResponse.json({ demo: null });

  const demo = typeof raw === "string" ? (JSON.parse(raw) as DemoTrip) : raw;

  // Confirm the underlying job still exists and finished successfully —
  // the demo trip's own record has no TTL, but the job it points at does
  // (JOB_TTL_SECONDS), so this is what actually catches a stale link
  // rather than showing a dead one.
  const job = await loadJob(demo.jobId);
  if (!job || job.status !== "done" || !job.result) {
    return NextResponse.json({ demo: null });
  }

  return NextResponse.json({ demo });
}
