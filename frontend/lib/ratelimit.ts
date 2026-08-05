// Rate limiting for the two write endpoints. /api/generate is the one that
// costs real Anthropic API money per request (each generation runs 1-2 live
// web searches per destination); unauthenticated + unlimited would mean
// anyone who finds the URL can run up the bill indefinitely. /api/feedback
// costs nothing per-call but writes to a durable (no-TTL) Redis list, so an
// unbounded stream of spam would still grow storage forever. Both share the
// same Upstash Redis instance the job queue already runs on — no new infra.
//
// This bounds worst-case cost per client; it is not a substitute for a
// bigger cost-control layer (auth, payments, Cloudflare-level bot
// protection) if abuse turns out to be from many rotating IPs rather than
// one repeat offender.

import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";

export interface RateLimitConfig {
  perHour: number;
  perDay: number;
  prefix: string;
}

export const GENERATE_RATE_LIMIT: RateLimitConfig = {
  perHour: Number(process.env.GENERATE_RATE_LIMIT_PER_HOUR ?? 5),
  perDay: Number(process.env.GENERATE_RATE_LIMIT_PER_DAY ?? 20),
  prefix: "ratelimit:generate",
};

export const FEEDBACK_RATE_LIMIT: RateLimitConfig = {
  perHour: Number(process.env.FEEDBACK_RATE_LIMIT_PER_HOUR ?? 30),
  perDay: Number(process.env.FEEDBACK_RATE_LIMIT_PER_DAY ?? 100),
  prefix: "ratelimit:feedback",
};

// /api/trip-questions costs real Anthropic money too, but far less per call
// than /api/generate (no web_search, a short reply, no large schema to
// fill) — a more generous limit reflects that real per-call cost, not a
// looser attitude toward abuse.
export const TRIP_QUESTIONS_RATE_LIMIT: RateLimitConfig = {
  perHour: Number(process.env.TRIP_QUESTIONS_RATE_LIMIT_PER_HOUR ?? 20),
  perDay: Number(process.env.TRIP_QUESTIONS_RATE_LIMIT_PER_DAY ?? 60),
  prefix: "ratelimit:trip-questions",
};

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

// Cached per prefix so repeated calls on a warm serverless instance reuse
// the same Ratelimit objects instead of reconstructing them every request.
const limiters = new Map<string, { hourly: Ratelimit; daily: Ratelimit }>();

function getLimiters(redis: Redis, config: RateLimitConfig) {
  let pair = limiters.get(config.prefix);
  if (!pair) {
    pair = {
      hourly: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.perHour, "1 h"),
        prefix: `${config.prefix}:hour`,
      }),
      daily: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.perDay, "1 d"),
        prefix: `${config.prefix}:day`,
      }),
    };
    limiters.set(config.prefix, pair);
  }
  return pair;
}

/** Checks both an hourly and a daily sliding-window limit for `ip`. Both
 * windows are always checked (and both count the attempt) so a client can't
 * dodge the daily cap by pacing requests just under the hourly one. */
export async function checkRateLimit(
  redis: Redis,
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const { hourly, daily } = getLimiters(redis, config);
  const [hourResult, dayResult] = await Promise.all([hourly.limit(ip), daily.limit(ip)]);

  if (!dayResult.success) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil((dayResult.reset - Date.now()) / 1000), 1),
      reason: `Daily limit of ${config.perDay} reached`,
    };
  }
  if (!hourResult.success) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil((hourResult.reset - Date.now()) / 1000), 1),
      reason: `Hourly limit of ${config.perHour} reached`,
    };
  }
  return { allowed: true };
}

/** Best-effort client IP from Vercel's forwarding headers. Falls back to a
 * shared "unknown" bucket if neither header is present (e.g. local dev
 * without a proxy in front) rather than skipping the limit entirely. */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
