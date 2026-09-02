// Polling endpoint for async generation jobs. Returns the job's current
// status/result as written by the worker (worker/src/index.ts) - this route
// itself never talks to Anthropic.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, stallReason, type Job } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json(
      { detail: "Server is misconfigured (job queue is not set up)." },
      { status: 500 }
    );
  }

  const raw = await redis.get<string | Job>(jobKey(id));
  if (raw == null) {
    return NextResponse.json(
      { detail: "Job not found - it may have expired or the id is invalid." },
      { status: 404 }
    );
  }

  // Upstash's client auto-deserializes JSON-looking strings, so this may
  // already be an object rather than a string depending on how it was set.
  const job: Job = typeof raw === "string" ? JSON.parse(raw) : raw;

  // A job that nothing is going to finish - either its worker died
  // mid-generation and left it at "running", or no worker ever took it off
  // the queue and it is still "pending". Reporting it as an error here is
  // what turns a five-minute spinner into something the traveler can act
  // on. Deliberately not written back to Redis: this route is a reader, and
  // if the worker is somehow still alive it should keep its own record.
  //
  // The two cases get different words on purpose. Telling someone to try
  // again is good advice after an interrupted run and useless advice when
  // the queue has no consumer - a retry there just buys them another five
  // minutes of spinner.
  const stall = stallReason(job);
  if (stall) {
    return NextResponse.json({
      ...job,
      status: "error",
      error:
        stall === "worker_restarted"
          ? "This generation stopped unexpectedly - the server restarted while it was running. Nothing was charged for the unfinished part. Please try again."
          : "The trip planner is offline right now, so this never started. Nothing was charged. We're on it - please try again shortly.",
    } satisfies Job);
  }

  return NextResponse.json(job);
}
