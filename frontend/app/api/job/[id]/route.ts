// Polling endpoint for async generation jobs. Returns the job's current
// status/result as written by the worker (worker/src/index.ts) — this route
// itself never talks to Anthropic.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, type Job } from "@/lib/jobs";

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
      { detail: "Job not found — it may have expired or the id is invalid." },
      { status: 404 }
    );
  }

  // Upstash's client auto-deserializes JSON-looking strings, so this may
  // already be an object rather than a string depending on how it was set.
  const job: Job = typeof raw === "string" ? JSON.parse(raw) : raw;

  return NextResponse.json(job);
}
