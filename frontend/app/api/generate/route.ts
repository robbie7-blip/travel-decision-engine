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
import type { TripBriefInput } from "@/lib/types";

export const runtime = "nodejs";

const VALID_PACES = new Set(["relaxed", "moderate", "packed"]);

class ValidationError extends Error {}

function cleanList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array of strings`);
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTripBrief(body: unknown): TripBriefInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  const destinations = cleanList(b.destinations, "destinations");
  if (destinations.length === 0) {
    throw new ValidationError("destinations must include at least one city.");
  }

  if (typeof b.start_date !== "string" || !b.start_date.trim()) {
    throw new ValidationError("start_date is required.");
  }
  if (typeof b.end_date !== "string" || !b.end_date.trim()) {
    throw new ValidationError("end_date is required.");
  }

  const partySize = Number(b.party_size);
  if (!Number.isFinite(partySize) || partySize < 1) {
    throw new ValidationError("party_size must be a number >= 1.");
  }

  if (typeof b.party_composition !== "string" || !b.party_composition.trim()) {
    throw new ValidationError("party_composition is required.");
  }

  let budget: number | null = null;
  if (b.budget_total_eur !== null && b.budget_total_eur !== undefined && b.budget_total_eur !== "") {
    budget = Number(b.budget_total_eur);
    if (!Number.isFinite(budget) || budget < 0) {
      throw new ValidationError("budget_total_eur must be a non-negative number or null.");
    }
  }

  if (typeof b.pace !== "string" || !VALID_PACES.has(b.pace)) {
    throw new ValidationError(`pace must be one of ${[...VALID_PACES].sort().join(", ")}.`);
  }

  return {
    destinations,
    start_date: b.start_date.trim(),
    end_date: b.end_date.trim(),
    party_size: Math.trunc(partySize),
    party_composition: b.party_composition.trim(),
    budget_total_eur: budget,
    pace: b.pace as TripBriefInput["pace"],
    interests: cleanList(b.interests, "interests"),
    dietary_constraints: cleanList(b.dietary_constraints, "dietary_constraints"),
    mobility_constraints: cleanList(b.mobility_constraints, "mobility_constraints"),
    hard_no: cleanList(b.hard_no, "hard_no"),
  };
}

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

  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = { id, status: "pending", brief, createdAt: now, updatedAt: now };

  await redis.set(jobKey(id), JSON.stringify(job), { ex: JOB_TTL_SECONDS });
  await redis.lpush(JOBS_QUEUE_KEY, id);

  return NextResponse.json({ jobId: id }, { status: 202 });
}
