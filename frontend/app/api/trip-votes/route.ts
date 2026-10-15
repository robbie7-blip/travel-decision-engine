// Votes on a trip's lines (see lib/tripVotes.ts).
//
// GET  ?jobId=   the counts, and this visitor's own votes.
// POST {jobId, ref, vote}   1 up, -1 down, 0 to take a vote back.
//
// The voter is an anonymous id in an httpOnly cookie, set on first use:
// the friends a trip is shared with should not need an account to say
// "not this museum". Counts only, never who voted what.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, ttlForJob, type Job } from "@/lib/jobs";
import { checkRateLimit, getClientIp, TRIP_VOTE_RATE_LIMIT } from "@/lib/ratelimit";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";
import {
  isVoterId,
  MAX_VOTE_FIELDS,
  parseVote,
  summariseVotes,
  VOTER_COOKIE_NAME,
  votesKey,
} from "@/lib/tripVotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOTER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

function voterCookie(response: NextResponse, voter: string) {
  response.cookies.set(VOTER_COOKIE_NAME, voter, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VOTER_COOKIE_MAX_AGE,
  });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!jobId || jobId.length > 100) return NextResponse.json({ detail: "jobId is required." }, { status: 400 });
  const voterRaw = request.cookies.get(VOTER_COOKIE_NAME)?.value;
  const voter = isVoterId(voterRaw) ? voterRaw : null;
  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }
  try {
    const hash = await redis.hgetall<Record<string, unknown>>(votesKey(jobId));
    return NextResponse.json(summariseVotes(hash, voter), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(summariseVotes(null, null), { headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  let parsed;
  try {
    parsed = parseVote(await request.json());
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!parsed.ok) return NextResponse.json({ detail: parsed.detail }, { status: 400 });

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }
  const rateLimit = await checkRateLimit(redis, getClientIp(request), TRIP_VOTE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json({ detail: `Too many votes - ${rateLimit.reason}.` }, { status: 429 });
  }

  // Only a finished trip can be voted on, and the hash is created with
  // that trip's own lifetime - so a vote cannot create a key for an id
  // that is not a trip, or outlive the trip it is about.
  const job = readJobRecord(await redis.get<string | Job>(jobKey(parsed.jobId)));
  if (!job || job.status !== "done" || !job.result) {
    return NextResponse.json({ detail: "That trip could not be found." }, { status: 404 });
  }

  const existing = request.cookies.get(VOTER_COOKIE_NAME)?.value;
  const voter = isVoterId(existing) ? existing : crypto.randomUUID();
  const key = votesKey(parsed.jobId);
  const field = `${parsed.ref}|${voter}`;

  if (parsed.vote === 0) {
    await redis.hdel(key, field);
  } else {
    if ((await redis.hlen(key)) >= MAX_VOTE_FIELDS && (await redis.hget(key, field)) === null) {
      return NextResponse.json({ detail: "This trip has all the votes it can hold." }, { status: 409 });
    }
    await redis.hset(key, { [field]: String(parsed.vote) });
    await redis.expire(key, ttlForJob(job));
  }

  const summary = summariseVotes(await redis.hgetall<Record<string, unknown>>(key), voter);
  const response = NextResponse.json(summary);
  if (voter !== existing) voterCookie(response, voter);
  return response;
}
