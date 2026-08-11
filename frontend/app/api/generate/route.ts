// Next.js API route — validates the trip brief and enqueues a job. Does NOT
// call Anthropic directly: that happens in the worker (worker/), a separate
// always-on process with no execution-time limit, which is what makes full
// web search viable (the old blocking-request version had to fit inside
// Vercel's 60s function-duration cap). This route's whole job is: validate,
// write a job record, push the id onto the queue, return the job id so the
// client can poll GET /api/job/[id].

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job } from "@/lib/jobs";
import { checkRateLimit, getClientIp, GENERATE_RATE_LIMIT } from "@/lib/ratelimit";
import { checkDailyBudget } from "@/lib/spendCheck";
import { parseTripBrief, ValidationError } from "@/lib/validation";
import { recordEvent, recordFunnelEvent } from "@/lib/analytics";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getUserRecord, getQuotaStatus, consumeQuota, resolvePlan } from "@/lib/account";
import { getVisitedCodes } from "@/lib/visited";
import { getCountry } from "@/lib/countries";
import { TEST_MODE_HEADER } from "@/lib/testMode";
import type { TripBriefInput } from "@/lib/types";

export const runtime = "nodejs";

/** True only if the request carries the exact ADMIN_PASSWORD as the
 * test-mode header — reuses the same shared secret /admin/* already gates
 * on (see middleware.ts), rather than inventing a second one. Constant-time
 * compare for the same reason session.ts uses one: this is a real
 * authorization check (bypasses rate limits AND the daily spend cap), not
 * just a UI toggle. */
function isTestModeRequest(request: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  const provided = request.headers.get(TEST_MODE_HEADER);
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

  const testMode = isTestModeRequest(request);

  // Signing in swaps a client OFF the anonymous per-IP abuse limiter below
  // and ONTO a per-email monthly quota sized by plan (see account.ts) — the
  // actual product tier, not just an abuse guard. Anonymous requests keep
  // the existing IP limiter untouched. Test mode (the site owner, verified
  // above) skips all of this below AND the daily budget check — it still
  // costs a little real money (see generateItinerary's forced skipSearch
  // for test-mode jobs in the worker), just not gated by guardrails meant
  // for the public.
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  let quotaPlan: "free" | "paid" | null = null;

  if (!testMode) {
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

    if (email) {
      const user = await getUserRecord(redis, email);
      const plan = resolvePlan(email, user?.subscriptionStatus ?? null);
      const quota = await getQuotaStatus(redis, email, plan);
      if (!quota.allowed) {
        const detail =
          plan === "paid"
            ? `You've used all ${quota.limit} generations included this month. It resets at the start of next month.`
            : `You've used all ${quota.limit} free generations this month. Upgrade for more, or wait for next month's reset.`;
        // Funnel visibility — a Free account hitting its cap is exactly
        // the moment an upgrade would make sense; worth knowing how often
        // that actually happens vs. how many people ever reach checkout.
        await recordFunnelEvent(redis, plan === "paid" ? "quota_blocked_paid" : "quota_blocked_free").catch(() => {});
        return NextResponse.json({ detail }, { status: 429 });
      }
      quotaPlan = plan;
    } else {
      // Every request here costs real Anthropic API money once the worker
      // picks it up (each generation runs 1-2 live web searches per
      // destination), so this is checked before any job is created — not
      // just cosmetically.
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
    }
  }

  // Soft personalization signal (see the visited_countries comment in
  // lib/types.ts) — resolved from the traveler's own trusted account
  // record, never from client input (parseTripBrief's allowlist already
  // dropped anything the client tried to pass under this key). A failure
  // here should never block generation, so it's swallowed the same way
  // recordEvent below is.
  if (email) {
    try {
      const codes = await getVisitedCodes(redis, email);
      const names = codes.map((code) => getCountry(code)?.name).filter((name): name is string => Boolean(name));
      if (names.length > 0) {
        brief = { ...brief, visited_countries: names };
      }
    } catch {
      // Personalization is optional — never breaks generation.
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = { id, status: "pending", brief, createdAt: now, updatedAt: now, ...(testMode ? { testMode } : {}) };

  await redis.set(jobKey(id), JSON.stringify(job), { ex: JOB_TTL_SECONDS });
  await redis.lpush(JOBS_QUEUE_KEY, id);

  if (email && quotaPlan) {
    // Consumed only now, after the job is actually enqueued — a failure
    // above (validation, budget) shouldn't cost the traveler a slot from
    // their monthly quota.
    try {
      await consumeQuota(redis, email);
    } catch {
      // Never block a successfully-enqueued job on the quota counter itself.
    }
  }

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
