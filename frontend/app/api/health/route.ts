// Public health check, for uptime monitors.
//
// Deliberately says almost nothing: two booleans and a word. It is
// unauthenticated, so it must not reveal which credentials are set, which
// host anything runs on, or what any error text said - that is
// /admin/health's job, behind the password.
//
// It does check more than "this process answered", because that was never
// the interesting failure. The Next.js app stays perfectly healthy while
// the worker is down; trips just queue forever and every traveler waits out
// the full poll and gets a generic error. So this returns 503 when the
// product cannot actually produce a trip, which is the thing worth being
// woken up for.

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { WORKER_HEARTBEAT_KEY, type WorkerHeartbeat } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // a cached health check is worse than none

export async function GET() {
  let redisOk = false;
  let workerOk = false;

  try {
    const redis = getRedis();
    const raw = await redis.get<string | WorkerHeartbeat>(WORKER_HEARTBEAT_KEY);
    redisOk = true;

    // The key carries its own TTL (WORKER_HEARTBEAT_TTL_SECONDS), so
    // freshness needs no timestamp comparison and no clock skew between two
    // hosts to get wrong. Existence is not quite enough on its own,
    // though: a value this endpoint cannot make sense of is not evidence of
    // a healthy worker, and answering "ok" to one would be the same false
    // reassurance the endpoint exists to prevent. So it has to parse and
    // look like a heartbeat.
    const beat = raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : raw;
    workerOk = typeof (beat as WorkerHeartbeat | null)?.updatedAt === "string";
  } catch {
    // Swallowed on purpose: the message could name the Redis host. A parse
    // failure lands here too and correctly leaves workerOk false.
  }

  const ok = redisOk && workerOk;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", redis: redisOk, worker: workerOk },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
