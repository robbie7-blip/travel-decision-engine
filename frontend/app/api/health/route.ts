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
import { isWorkerHeartbeat } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never prerendered at build time

/** How long a shared cache may serve the same verdict.
 *
 * This route went from zero I/O to one Upstash read per request, and it is
 * unauthenticated by design, so `while true; do curl ...; done` from one
 * host would bill Upstash commands and Vercel invocations at line rate on
 * a project that rate-limits every other route it exposes.
 *
 * Ten seconds is the cheapest fix that keeps it honest: an uptime monitor
 * polls on the order of a minute, so it never sees stale data in practice,
 * while a flood collapses to at most six origin reads a minute. Rate
 * limiting instead would have meant a Redis round trip per request to
 * decide whether to do a Redis round trip. */
const CACHE_SECONDS = 10;

export async function GET() {
  let redisOk = false;
  let workerOk = false;

  try {
    const redis = getRedis();
    const raw = await redis.get<string | WorkerHeartbeat>(WORKER_HEARTBEAT_KEY);
    redisOk = true;

    // The key carries its own TTL (WORKER_HEARTBEAT_TTL_SECONDS), so
    // freshness needs no timestamp comparison and no clock skew between two
    // hosts to get wrong. Existence alone is not enough, though: a value
    // this endpoint cannot make sense of is not evidence of a healthy
    // worker, and answering "ok" to one is the false reassurance the
    // endpoint exists to prevent.
    //
    // Deliberately the SAME check /admin/health uses, not a second
    // hand-written one. This route previously accepted any object with a
    // string updatedAt, so a heartbeat reading {"updatedAt":"nope"}
    // answered "ok" to an uptime monitor while the admin page correctly
    // called it unreadable - two implementations of one question, already
    // disagreeing.
    const beat = raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : raw;
    workerOk = isWorkerHeartbeat(beat);
  } catch {
    // Swallowed on purpose: the message could name the Redis host. A parse
    // failure lands here too and correctly leaves workerOk false.
  }

  const ok = redisOk && workerOk;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", redis: redisOk, worker: workerOk },
    {
      status: ok ? 200 : 503,
      headers: {
        // private=no, so a shared cache may hold it; max-age=0 so the
        // browser always revalidates and a person refreshing the URL sees
        // the current answer.
        "cache-control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
      },
    }
  );
}
