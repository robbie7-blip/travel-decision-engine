// Starts a dropped generation again.
//
// WHAT THIS IS FOR. /api/job/[id] already diagnoses a trip that nothing is
// going to finish - a worker that restarted mid-generation, or a job that
// no worker ever took off the queue - and tells the traveller so instead
// of leaving them on a five-minute spinner. What it could not do was give
// them anywhere to go: the only route back from an interrupted generation
// was the homepage and the whole form again, retyped, for a trip the
// server had already been told about in full.
//
// WHY IT IS A ROUTE AND NOT A BUTTON THAT RE-POSTS THE BRIEF. The trip page
// does not have the brief. It has a PublicTripBrief, which is an allowlist
// on purpose: mobility_constraints, dietary_constraints, hard_no, the
// budget, the origin, the party size and the named hotel are all withheld,
// because a trip link is shareable and three of those are special-category
// personal data (lib/publicBrief.ts). A retry built from what the page
// holds would therefore have generated a DIFFERENT trip - the wheelchair
// access, the coeliac diet and the budget quietly dropped - for exactly the
// travellers who most need them honoured, and it would have looked like it
// worked. The authoritative brief is in the job record. It is read from
// there, and it never leaves the server. /api/refine made the same move,
// for the same reason.
//
// WHAT IT COSTS. The decision about whether a given job may be retried at
// all, including the one-retry-per-job limit, is in lib/retrySource.ts
// where it can be tested. This route is the plumbing around it: the same
// daily spend cap and the same per-IP rate limit as /api/generate and
// /api/refine, because this starts an identical generation and must not be
// a way around either.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, SAVED_JOB_TTL_SECONDS, jobKey, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { checkRateLimit, getClientIp, GENERATE_RATE_LIMIT } from "@/lib/ratelimit";
import { checkDailyBudget } from "@/lib/spendCheck";
import { retrySource } from "@/lib/retrySource";
import { recordEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const request = _request;
  const { id: sourceJobId } = await context.params;

  // Bounded before it becomes a Redis key, the same shape check
  // /api/refine makes on the id it is handed. Whether the job EXISTS is a
  // Redis question, answered after the limiters below on purpose: looking
  // a job id up must not be cheaper than generating, or this becomes a way
  // to probe for ids at speed.
  if (!sourceJobId || sourceJobId.length > 100) {
    return NextResponse.json({ detail: "That is not a valid trip id." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured (job queue is not set up)." }, { status: 500 });
  }

  const budget = await checkDailyBudget(redis);
  if (!budget.allowed) {
    return NextResponse.json(
      { detail: "We've hit today's usage budget for generating new itineraries. Please try again tomorrow." },
      { status: 503 }
    );
  }

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

  const raw = await redis.get<string | Job>(jobKey(sourceJobId));
  const source = retrySource(raw);
  if (!source.ok) {
    return NextResponse.json({ detail: source.detail }, { status: source.status });
  }
  const { job: original, brief } = source;

  // The original is marked FIRST, so a double tap (or two tabs) cannot
  // both get past retrySource and enqueue two generations. Marking after
  // the enqueue would leave that window open for the length of a Redis
  // round trip, which is exactly long enough.
  //
  // Written back under the record's own lifetime rather than a fresh
  // default - see ttlSeconds on Job: a plain SET here would silently cut a
  // saved trip's 400 days down to thirty.
  const originalTtl = original.ttlSeconds ?? JOB_TTL_SECONDS;
  await redis.set(
    jobKey(sourceJobId),
    JSON.stringify({ ...original, retriedAt: Date.now() } satisfies Job),
    { ex: originalTtl }
  );

  const id = crypto.randomUUID();
  const now = Date.now();
  // A retry is a new job with a new id, so the lifetime decision is made
  // again rather than inherited - the same reasoning /api/refine documents:
  // the version the traveller keeps is the one that finished.
  const ownerEmail = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const ttlSeconds = ownerEmail ? SAVED_JOB_TTL_SECONDS : JOB_TTL_SECONDS;
  const retry: Job = {
    id,
    status: "pending",
    brief,
    createdAt: now,
    updatedAt: now,
    ttlSeconds,
    replaces: sourceJobId,
    ...(ownerEmail ? { ownerEmail } : {}),
    // Inherited deliberately: a test-mode generation that the server drops
    // has to be retryable without the owner's key being re-sent, and a
    // retry of a test generation is still a test generation.
    ...(original.testMode ? { testMode: true } : {}),
  };

  await redis.set(jobKey(id), JSON.stringify(retry), { ex: ttlSeconds });
  await redis.lpush(JOBS_QUEUE_KEY, id);

  try {
    // Counted as a "generate", not as its own event type, and that is the
    // honest number rather than the convenient one: this enqueues an
    // identical generation and spends an identical model call, so the
    // generate counter would be understating real usage if retries sat in
    // a bucket of their own. How often the server DROPS a job is already
    // answerable - /admin/health lists the worker's own failures.
    await recordEvent(redis, "generate", brief.language);
  } catch {
    // Analytics must never break a retry - swallow and move on.
  }

  return NextResponse.json({ jobId: id }, { status: 202 });
}
