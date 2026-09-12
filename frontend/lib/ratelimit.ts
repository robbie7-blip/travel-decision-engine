// Rate limiting for the two write endpoints. /api/generate is the one that
// costs real Anthropic API money per request (each generation runs 1-2 live
// web searches per destination); unauthenticated + unlimited would mean
// anyone who finds the URL can run up the bill indefinitely. /api/feedback
// costs nothing per-call but writes to a durable (no-TTL) Redis list, so an
// unbounded stream of spam would still grow storage forever. Both share the
// same Upstash Redis instance the job queue already runs on - no new infra.
//
// This bounds worst-case cost per client; it is not a substitute for a
// bigger cost-control layer (auth, payments, Cloudflare-level bot
// protection) if abuse turns out to be from many rotating IPs rather than
// one repeat offender.
//
// Every limit below is read through envInt rather than Number(). These are
// the numbers that stand between a public endpoint and an unbounded
// Anthropic bill, and the naive read fails OPEN: an env var set to an empty
// string gives 0 (Ratelimit.slidingWindow(0) rejects everything - the whole
// site down), and a typo gives NaN, which is worse in the other direction
// because a NaN limit compares false against every count. See envNumber.ts.

import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { envInt } from "./envNumber";

export interface RateLimitConfig {
  perHour: number;
  perDay: number;
  prefix: string;
}

export const GENERATE_RATE_LIMIT: RateLimitConfig = {
  perHour: envInt("GENERATE_RATE_LIMIT_PER_HOUR", 5),
  perDay: envInt("GENERATE_RATE_LIMIT_PER_DAY", 20),
  prefix: "ratelimit:generate",
};

export const FEEDBACK_RATE_LIMIT: RateLimitConfig = {
  perHour: envInt("FEEDBACK_RATE_LIMIT_PER_HOUR", 30),
  perDay: envInt("FEEDBACK_RATE_LIMIT_PER_DAY", 100),
  prefix: "ratelimit:feedback",
};

// /api/trip-questions costs real Anthropic money too, but far less per call
// than /api/generate (no web_search, a short reply, no large schema to
// fill) - a more generous limit reflects that real per-call cost, not a
// looser attitude toward abuse.
export const TRIP_QUESTIONS_RATE_LIMIT: RateLimitConfig = {
  perHour: envInt("TRIP_QUESTIONS_RATE_LIMIT_PER_HOUR", 20),
  perDay: envInt("TRIP_QUESTIONS_RATE_LIMIT_PER_DAY", 60),
  prefix: "ratelimit:trip-questions",
};

// Flight-history import is one Anthropic call per pasted confirmation, with
// a bounded input and a small structured output - closer in cost to a trip
// question than a full generation. Someone importing a backlog will
// legitimately paste a run of these in one sitting, so the hourly allowance
// is deliberately generous; the daily cap is what actually bounds abuse.
export const FLIGHT_IMPORT_RATE_LIMIT: RateLimitConfig = {
  perHour: envInt("FLIGHT_IMPORT_RATE_LIMIT_PER_HOUR", 40),
  perDay: envInt("FLIGHT_IMPORT_RATE_LIMIT_PER_DAY", 120),
  prefix: "ratelimit:flight-import",
};

// Magic-link requests cost nothing per-call in Anthropic terms, but an
// unbounded stream would spam a stranger's inbox (anyone can type any email
// in) and burn through the transactional-email provider's quota. Keyed by
// IP below, same as the other limiters - deliberately not also keyed by the
// target email, since that would need its own separate check to avoid
// leaking "this email has requested N links" as a side channel.
export const AUTH_RATE_LIMIT: RateLimitConfig = {
  perHour: envInt("AUTH_RATE_LIMIT_PER_HOUR", 5),
  perDay: envInt("AUTH_RATE_LIMIT_PER_DAY", 15),
  prefix: "ratelimit:auth",
};

// The anonymous visited-stats share write (app/api/visited/share, POST) -
// the one write in the app where an UNAUTHENTICATED caller chooses its own
// Redis key, and the key lives for 400 days. Validating the codes bounds how
// large each snapshot can be; this bounds how many of them one caller can
// create. Deliberately generous, because the visited page POSTs here on
// every country toggle once a share link exists, so ticking off a long list
// is a long run of legitimate calls.
export const VISITED_SHARE_RATE_LIMIT: RateLimitConfig = {
  perHour: envInt("VISITED_SHARE_RATE_LIMIT_PER_HOUR", 120),
  perDay: envInt("VISITED_SHARE_RATE_LIMIT_PER_DAY", 600),
  prefix: "ratelimit:visited-share",
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
/** Only the characters a real IP address can contain: hex digits, dots,
 * colons, and a `%` zone index. Anything else is a forged or mangled value,
 * and it would also become part of a Redis key. */
const IP_CHARS = /^[0-9a-f.:%]+$/;

/** The longest legal textual IP is a 45-character IPv4-mapped IPv6. Past
 * that it is not an address, and a caller who can choose a long one can
 * choose a different long one on every request. */
const MAX_IP_CHARS = 64;

/** Cleans one candidate address, or returns null if it cannot be one.
 *
 * Strips an `[...]` IPv6 wrapper and a trailing `:port`, which some proxies
 * append - `1.2.3.4:5678` and `1.2.3.4` must land in the SAME rate-limit
 * bucket, or a client that varies the port gets a fresh allowance each
 * time. A bare IPv6 address is full of colons, so the port is only removed
 * when the shape is unambiguous: bracketed, or exactly one colon. */
function normalizeIp(raw: string | null | undefined): string | null {
  let value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if ((value.match(/:/g) ?? []).length === 1) value = value.split(":")[0];

  if (!value || value.length > MAX_IP_CHARS || !IP_CHARS.test(value)) return null;
  return value;
}

/** The client's address, for rate limiting.
 *
 * This used to read `x-forwarded-for` and take the FIRST entry, which is
 * the one part of that header a client fully controls. `curl -H
 * "X-Forwarded-For: 1.2.3.4"` therefore chose its own rate-limit bucket,
 * and a different value per request meant a fresh allowance per request -
 * so every per-IP limit in this file was bypassable by anyone who thought
 * to try it.
 *
 * That is the single guard in front of six public endpoints: /api/generate
 * and /api/refine (a paid generation each), /api/trip-questions and
 * /api/flight-import (a paid model call each), /api/feedback (durable,
 * no-TTL Redis writes), and /api/auth/request-link, which sends a magic
 * link to any address the caller types - the one where an unbounded stream
 * spams a stranger's inbox and burns the email provider's quota. The
 * header at the top of this file says "unauthenticated + unlimited would
 * mean anyone who finds the URL can run up the bill indefinitely"; that was
 * the state it was in. The daily spend cap still bounded the total bill, but
 * the per-IP limits are what stop ONE actor consuming everyone's budget,
 * and they were not doing it.
 *
 * Order matters, most trustworthy first. The platform-set headers are
 * preferred because the hosting layer writes them from the connection
 * itself; `x-forwarded-for` is the fallback and its LAST entry is used, not
 * its first - a proxy appends the address it received the request from, so
 * the last hop is the one written by the nearest trusted proxy while
 * everything before it may have been supplied by the caller. */
export function getClientIp(request: Request): string {
  // Vercel writes this one itself, from the connection.
  const platform =
    normalizeIp(request.headers.get("x-vercel-forwarded-for")) ??
    normalizeIp(request.headers.get("x-real-ip"));
  if (platform) return platform;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",");
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = normalizeIp(hops[i]);
      if (hop) return hop;
    }
  }

  // Everything unidentifiable shares ONE bucket. That is the safe direction:
  // a shared allowance throttles a caller who strips every header, where a
  // per-request unique fallback would hand them an unlimited one.
  return "unknown";
}
