// The client's address, for rate limiting - and for anything else that has
// to bucket a caller.
//
// Its own module because the ADMIN GATE needs it and cannot have
// lib/ratelimit.ts. That file imports @upstash/ratelimit and lib/redis.ts,
// whose resolved entry point is @upstash/redis/nodejs.mjs, and middleware
// runs on the Edge runtime, where the build says plainly: "A Node.js API is
// used (process.version) which is not supported in the Edge Runtime."
// Nothing in here touches anything but request headers, so it is
// Edge-native on its own; it was only the company it kept.
//
// lib/ratelimit.ts re-exports getClientIp, so every existing caller and its
// own suite are unchanged - this is a move, not a rewrite.
//
// Run: npm run test:ratelimit

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
