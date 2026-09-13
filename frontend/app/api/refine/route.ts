// Next.js API route for the pushback/follow-up feature: takes the id of a
// finished trip and the traveler's question about it, and enqueues a
// refinement job - same job-queue mechanics as /api/generate (see that
// route for the full rationale), just with a `refinement` field set so the
// worker knows to build a follow-up prompt instead of a fresh one (see
// buildRefinementPrompt).
//
// It used to take the BRIEF AND THE ITINERARY IN THE REQUEST BODY, which
// is what forced /api/job/[id] - a public, unauthenticated endpoint - to
// publish the traveler's entire brief on a shareable link, disability
// disclosures and budget included. lib/api.ts said so in as many words: the
// brief rides along "since a page loading a job cold needs it to submit a
// pushback".
//
// Reading both out of the job record instead fixes that and two smaller
// things with it:
//
//   - The brief that refines a trip is now provably the brief that
//     GENERATED it. Before, it was whatever the client posted back, so a
//     round-trip through the page could quietly drop a field - and the
//     fields most worth dropping accidentally (mobility, dietary, hard_no)
//     are the ones a traveler would notice missing from the refined
//     version.
//   - The refinement prompt is no longer attacker-supplied. `itinerary`
//     was parsed by checking it had a `days` array and then cast, so any
//     caller could hand this route arbitrary content to be quoted into a
//     model call as "the itinerary already shown to the traveler".

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, SAVED_JOB_TTL_SECONDS, jobKey, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { checkRateLimit, getClientIp, GENERATE_RATE_LIMIT } from "@/lib/ratelimit";
import { checkDailyBudget } from "@/lib/spendCheck";
import { ValidationError } from "@/lib/validation";
import { refineSource } from "@/lib/refineSource";
import { recordEvent } from "@/lib/analytics";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 500;

/** The id of the trip being refined. Only a shape check - whether the job
 * exists is a Redis question, answered below and deliberately AFTER the
 * rate limiter, so this route cannot be used to probe for job ids any
 * faster than it can be used to generate. */
function parseJobId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("jobId is required.");
  }
  const trimmed = value.trim();
  // Job ids are crypto.randomUUID() here and in /api/generate. Bounded so
  // a long string cannot be turned into a long Redis key.
  if (trimmed.length > 100) {
    throw new ValidationError("jobId is not a valid trip id.");
  }
  return trimmed;
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
  let sourceJobId: string;
  let question: string;
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new ValidationError("Request body must be a JSON object.");
    }
    const b = body as Record<string, unknown>;
    sourceJobId = parseJobId(b.jobId);
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

  // Same global spend cap as /api/generate - a refinement costs the same
  // as a fresh generation, so it draws from the same daily budget too.
  const budget = await checkDailyBudget(redis);
  if (!budget.allowed) {
    return NextResponse.json(
      { detail: "We've hit today's usage budget for generating new itineraries. Please try again tomorrow." },
      { status: 503 }
    );
  }

  // A refinement costs the same as a fresh generation (one model call, same
  // search-tool access), so it draws from the exact same rate-limit budget -
  // otherwise pushback would be a free way around the /api/generate cap.
  const rateLimit = await checkRateLimit(redis, getClientIp(request), GENERATE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many requests - ${rateLimit.reason}. Try again in ~${minutes} minute(s).` },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      }
    );
  }

  // The trip being refined, read from the record rather than taken from
  // the caller. After the rate limiter on purpose: a lookup that answers
  // "does this job exist" must not be cheaper than a generation.
  //
  // The decision itself lives in lib/refineSource.ts, where it can be
  // tested - see the note at the top of that file.
  const source = refineSource(await redis.get<string | Job>(jobKey(sourceJobId)));
  if (!source.ok) {
    return NextResponse.json({ detail: source.detail }, { status: source.status });
  }
  const { brief, baseItinerary } = source;

  const id = crypto.randomUUID();
  const now = Date.now();
  // A refinement is a new job with a new id, so it needs the lifetime
  // decision made again - it does not inherit the original's. Without
  // this, answering a question about a saved trip produced a REPLACEMENT
  // that expired in thirty days while the trip it came from lived for
  // over a year, and the refined version is the one the traveller keeps.
  const ttlSeconds = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value)
    ? SAVED_JOB_TTL_SECONDS
    : JOB_TTL_SECONDS;
  const job: Job = {
    id,
    status: "pending",
    brief,
    refinement: { question, baseItinerary },
    createdAt: now,
    updatedAt: now,
    ttlSeconds,
  };

  await redis.set(jobKey(id), JSON.stringify(job), { ex: ttlSeconds });
  await redis.lpush(JOBS_QUEUE_KEY, id);

  try {
    await recordEvent(redis, "refine", brief.language);
  } catch {
    // Analytics must never break refinement - swallow and move on.
  }

  return NextResponse.json({ jobId: id }, { status: 202 });
}
