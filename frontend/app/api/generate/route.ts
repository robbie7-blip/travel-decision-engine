// Next.js API route — validates the trip brief and enqueues a job. Does NOT
// call Anthropic directly: that happens in the worker (worker/), a separate
// always-on process with no execution-time limit, which is what makes full
// web search viable (the old blocking-request version had to fit inside
// Vercel's 60s function-duration cap). This route's whole job is: validate,
// write a job record, push the id onto the queue, return the job id so the
// client can poll GET /api/job/[id].

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job } from "@/lib/jobs";
import { checkRateLimit, getClientIp, GENERATE_RATE_LIMIT } from "@/lib/ratelimit";
import { checkDailyBudget } from "@/lib/spendCheck";
import { parseTripBrief, ValidationError } from "@/lib/validation";
import { recordEvent } from "@/lib/analytics";
import type { TripBriefInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let brief: TripBriefInput;
  try {
    const body = await request.json();
    brief = parseTripBrief(body);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ detail: e.message }, { status: 400 });
    }
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json(
      { detail: "Server is misconfigured (job queue is not set up)." },
      { status: 500 }
    );
  }

  // Global check first: if today's aggregate spend is already at budget,
  // there's no point burning this client's per-IP rate-limit quota on a
  // request that's going to be rejected anyway.
  const budget = await checkDailyBudget(redis);
  if (!budget.allowed) {
    return NextResponse.json(
      { detail: "We've hit today's usage budget for generating new itineraries. Please try again tomorrow." },
      { status: 503 }
    );
  }

  // Every request here costs real Anthropic API money once the worker picks
  // it up (each generation runs 1-2 live web searches per destination), so
  // this is checked before any job is created — not just cosmetically.
  const rateLimit = await checkRateLimit(redis, getClientIp(request), GENERATE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many requests — ${rateLimit.reason}. Try again in ~${minutes} minute(s).` },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      }
    );
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = { id, status: "pending", brief, createdAt: now, updatedAt: now };

  await redis.set(jobKey(id), JSON.stringify(job), { ex: JOB_TTL_SECONDS });
  await redis.lpush(JOBS_QUEUE_KEY, id);

  // Awaited, not fire-and-forget: a serverless function isn't guaranteed to
  // keep running after it returns a response, so an un-awaited promise here
  // could get silently cut off most of the time.
  try {
    await recordEvent(redis, "generate", brief.language);
  } catch {
    // Analytics must never break generation — swallow and move on.
  }

  return NextResponse.json({ jobId: id }, { status: 202 });
}
