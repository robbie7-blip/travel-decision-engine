// Next.js API route for the pushback/follow-up feature: takes the trip
// brief, the itinerary already shown to the traveler, and their question
// about it, and enqueues a refinement job — same job-queue mechanics as
// /api/generate (see that route for the full rationale), just with a
// `refinement` field set so the worker knows to build a follow-up prompt
// instead of a fresh one (see buildRefinementPrompt).

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job } from "@/lib/jobs";
import { checkRateLimit, getClientIp, GENERATE_RATE_LIMIT } from "@/lib/ratelimit";
import { parseTripBrief, ValidationError } from "@/lib/validation";
import type { Itinerary, TripBriefInput } from "@/lib/types";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 500;

function parseBaseItinerary(value: unknown): Itinerary {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { days?: unknown }).days)) {
    throw new ValidationError("itinerary must be a previously generated itinerary object.");
  }
  return value as Itinerary;
}

function parseQuestion(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("question is required.");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new ValidationError(`question must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

export async function POST(request: NextRequest) {
  let brief: TripBriefInput;
  let baseItinerary: Itinerary;
  let question: string;
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new ValidationError("Request body must be a JSON object.");
    }
    const b = body as Record<string, unknown>;
    brief = parseTripBrief(b.brief);
    baseItinerary = parseBaseItinerary(b.itinerary);
    question = parseQuestion(b.question);
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

  // A refinement costs the same as a fresh generation (one model call, same
  // search-tool access), so it draws from the exact same rate-limit budget —
  // otherwise pushback would be a free way around the /api/generate cap.
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
  const job: Job = {
    id,
    status: "pending",
    brief,
    refinement: { question, baseItinerary },
    createdAt: now,
    updatedAt: now,
  };

  await redis.set(jobKey(id), JSON.stringify(job), { ex: JOB_TTL_SECONDS });
  await redis.lpush(JOBS_QUEUE_KEY, id);

  return NextResponse.json({ jobId: id }, { status: 202 });
}
