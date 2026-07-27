// Next.js API route — persists user feedback on a specific itinerary line
// item (helpful / wrong, with an optional comment). This is the start of
// the trust-feedback loop: real users flagging real inaccuracies is the
// only signal that tells us whether the grounding/search/confidence-tier
// machinery is actually working once this is in front of people who aren't
// us testing it. Stored with no TTL (unlike job records), since the whole
// point is to accumulate this over time rather than let it expire.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { FEEDBACK_LIST_KEY, MAX_COMMENT_LENGTH, type FeedbackEntry, type FeedbackRating } from "@/lib/feedback";
import { checkRateLimit, getClientIp, FEEDBACK_RATE_LIMIT } from "@/lib/ratelimit";

export const runtime = "nodejs";

const VALID_RATINGS = new Set<FeedbackRating>(["helpful", "wrong"]);
const MAX_JOB_ID_LENGTH = 100;
const MAX_ITEM_JSON_LENGTH = 5000;

class ValidationError extends Error {}

function parseFeedback(body: unknown): Omit<FeedbackEntry, "id" | "createdAt"> {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.jobId !== "string" || !b.jobId.trim() || b.jobId.length > MAX_JOB_ID_LENGTH) {
    throw new ValidationError("jobId is required.");
  }

  const day = Number(b.day);
  if (!Number.isFinite(day)) {
    throw new ValidationError("day must be a number.");
  }

  if (typeof b.item !== "object" || b.item === null || Array.isArray(b.item)) {
    throw new ValidationError("item must be an object.");
  }
  if (JSON.stringify(b.item).length > MAX_ITEM_JSON_LENGTH) {
    throw new ValidationError("item is too large.");
  }

  if (typeof b.rating !== "string" || !VALID_RATINGS.has(b.rating as FeedbackRating)) {
    throw new ValidationError(`rating must be one of ${[...VALID_RATINGS].sort().join(", ")}.`);
  }

  let comment: string | undefined;
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") {
      throw new ValidationError("comment must be a string.");
    }
    comment = b.comment.trim().slice(0, MAX_COMMENT_LENGTH) || undefined;
  }

  return {
    jobId: b.jobId.trim(),
    day: Math.trunc(day),
    item: b.item as FeedbackEntry["item"],
    rating: b.rating as FeedbackRating,
    comment,
  };
}

export async function POST(request: NextRequest) {
  let parsed: Omit<FeedbackEntry, "id" | "createdAt">;
  try {
    const body = await request.json();
    parsed = parseFeedback(body);
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
      { detail: "Server is misconfigured (feedback store is not set up)." },
      { status: 500 }
    );
  }

  // No Anthropic cost here, but this list has no TTL, so unbounded spam
  // would still grow storage forever.
  const rateLimit = await checkRateLimit(redis, getClientIp(request), FEEDBACK_RATE_LIMIT);
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

  const entry: FeedbackEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...parsed,
  };

  await redis.rpush(FEEDBACK_LIST_KEY, JSON.stringify(entry));

  return NextResponse.json({ ok: true }, { status: 201 });
}
