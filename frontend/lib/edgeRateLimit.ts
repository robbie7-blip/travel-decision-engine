// A rate-limit counter that actually runs on the Edge.
//
// WHY NOT lib/ratelimit.ts. Because it cannot run here, and the build says
// so out loud. Middleware runs on the Edge runtime; importing lib/redis.ts
// pulls in @upstash/redis, whose resolved entry point is nodejs.mjs, and:
//
//   ./node_modules/@upstash/redis/nodejs.mjs
//   A Node.js API is used (process.version at line: 240) which is not
//   supported in the Edge Runtime.
//
// A warning, not an error, so it would have deployed - and then either
// thrown inside the admin gate (500 on every /admin request) or worked until
// it didn't. It also put 25 kB of client and sliding-window machinery into
// the middleware bundle for one counter.
//
// Upstash's REST API is plain HTTP with a Bearer token, and `fetch` is the
// one thing the Edge runtime definitely has. So this is the counter and
// nothing else: two fixed windows, one pipelined round-trip, no dependency.
//
// FIXED window, not sliding, and the key is what makes that correct: the
// window number is part of the key name, so re-setting the TTL on every
// increment cannot extend the window a caller is already in. A sliding
// window would be nicer and needs sorted sets and more round-trips than one
// counter is worth.
//
// Run: npm run test:edge-rate-limit

/** One window: how long, and how many failures it allows. */
export interface EdgeWindow {
  seconds: number;
  limit: number;
}

export interface EdgeLimitResult {
  allowed: boolean;
  /** Which window ran out, for a log line. Never sent to the caller - a
   * guesser should not be handed the shape of the limit. */
  exceeded?: string;
}

/** The commands for one window, as Upstash REST pipeline entries.
 *
 * INCR then EXPIRE. The TTL is re-set on every increment, which is harmless
 * precisely because `bucket` is in the key: a caller who keeps failing keeps
 * refreshing the TTL of the window they are ALREADY in, and the next window
 * is a different key that starts from zero.
 *
 * Exported for the test, which is the only way to assert the commands
 * without a live Upstash. */
export function windowCommands(prefix: string, identifier: string, now: number, window: EdgeWindow): string[][] {
  const bucket = Math.floor(now / (window.seconds * 1000));
  const key = `${prefix}:${window.seconds}:${bucket}:${identifier}`;
  return [
    ["INCR", key],
    ["EXPIRE", key, String(window.seconds)],
  ];
}

/** How long to wait for the counter before giving up.
 *
 * Short, because this sits in front of a page load and the caller fails
 * CLOSED on a timeout - so a slow counter costs the owner access, not an
 * attacker their guesses. Two seconds is far above a normal Upstash REST
 * round-trip and far below a browser's patience. */
const TIMEOUT_MS = 2_000;

/** Counts one event against every window and says whether it is allowed.
 *
 * REFUSES on any failure - unreachable, non-200, unparseable, timed out.
 * That is the opposite of every limiter in lib/ratelimit.ts and the reason
 * is what is being guarded: those bound COST, where turning away a paying
 * traveller is worse than serving one extra request, and this guards a
 * CREDENTIAL, where the same trade runs the other way. The caller is
 * responsible for only counting events that have already failed, so this
 * can never refuse someone holding the right password.
 *
 * `fetchImpl` is injectable so the test can assert what goes over the wire
 * and what each kind of failure does, without a live Upstash. */
export async function checkEdgeLimit(
  prefix: string,
  identifier: string,
  windows: EdgeWindow[],
  options: {
    url?: string | null;
    token?: string | null;
    now?: number;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<EdgeLimitResult> {
  const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  // Unconfigured is a failure, not a licence. A deployment with no Redis
  // cannot count attempts, and "cannot count" must not read as "unlimited"
  // on a credential gate.
  if (!url || !token || windows.length === 0) return { allowed: false, exceeded: "unconfigured" };

  const now = options.now ?? Date.now();
  const doFetch = options.fetchImpl ?? fetch;
  const commands = windows.flatMap((w) => windowCommands(prefix, identifier, now, w));

  let results: { result?: unknown }[];
  try {
    const res = await doFetch(`${url.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { allowed: false, exceeded: `http-${res.status}` };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { allowed: false, exceeded: "bad-body" };
    results = body as { result?: unknown }[];
  } catch {
    return { allowed: false, exceeded: "unreachable" };
  }

  // Two commands per window, and the count is the first of each pair.
  for (const [i, window] of windows.entries()) {
    const count = results[i * 2]?.result;
    // A count that is not a number means the pipeline did not do what was
    // asked. Refusing is the only safe reading of that.
    if (typeof count !== "number" || !Number.isFinite(count)) {
      return { allowed: false, exceeded: "bad-count" };
    }
    if (count > window.limit) return { allowed: false, exceeded: `${window.seconds}s` };
  }
  return { allowed: true };
}

/** FAILED admin-auth attempts, by IP.
 *
 * Tight, because a person who knows the password needs one attempt and a
 * browser retries a Basic Auth prompt a couple of times before showing the
 * box. Successful attempts are never counted (see middleware.ts), so the
 * owner cannot spend these.
 *
 * Not read through envInt like lib/ratelimit.ts's numbers: those are tuned
 * per deployment because they bound spend. This one bounds guesses at a
 * credential, where a deployment-specific loosening is not a knob worth
 * exposing. */
export const ADMIN_AUTH_WINDOWS: EdgeWindow[] = [
  { seconds: 3600, limit: 10 },
  { seconds: 86_400, limit: 40 },
];

export const ADMIN_AUTH_PREFIX = "ratelimit:admin-auth";
