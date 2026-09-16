// The counter behind the admin gate.
//
// It exists because lib/ratelimit.ts cannot run where it is needed.
// Middleware runs on the Edge runtime; lib/ratelimit.ts imports
// @upstash/ratelimit and lib/redis.ts, and the build says plainly:
//
//   ./node_modules/@upstash/redis/nodejs.mjs
//   A Node.js API is used (process.version at line: 240) which is not
//   supported in the Edge Runtime.
//
// A WARNING, not an error - so the first version of the admin limiter would
// have deployed and then either thrown inside the gate (a 500 on every
// /admin request) or worked until it didn't. It also put 25 kB into the
// middleware bundle for one counter; measured, the middleware went 34.2 kB
// -> 59.9 kB and back to 35.0 kB once this replaced it.
//
// So: Upstash's REST API over plain `fetch`, which is the one thing the Edge
// runtime definitely has. `fetchImpl` is injected below so every assertion
// here is about what actually goes over the wire and what each kind of
// failure does, with no live Upstash and no network.
//
// THE PROPERTY THAT MATTERS is that every failure refuses. This is the only
// limiter in the app that fails closed, and the reason is what it guards:
// the others bound cost, where turning away a paying traveller is worse than
// serving one extra request; this bounds guesses at a credential, where a
// counter that cannot count must not read as "unlimited".
//
// Run: npm run test:edge-rate-limit

import { checkEdgeLimit, windowCommands, type EdgeWindow } from "./edgeRateLimit";
import { check, finish, heading, section } from "./testutil";

heading("the edge rate-limit counter");

const URL_BASE = "https://example.upstash.io";
const TOKEN = "test-token";
const HOUR: EdgeWindow = { seconds: 3600, limit: 10 };
const DAY: EdgeWindow = { seconds: 86_400, limit: 40 };

/** A fetch that answers with the given INCR counts, one per window, and
 * records what it was asked. */
function fakeFetch(counts: number[], init?: { ok?: boolean; status?: number; body?: unknown }) {
  // `init.body ?? results` would swallow a deliberate null - which is one of
  // the bodies worth asserting about, and the first run of this file failed
  // on exactly that. The harness has to distinguish "no override" from
  // "override with null".
  const hasBody = init !== undefined && "body" in init;
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const impl = (async (url: string | URL | Request, options?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((options?.headers ?? {}) as Record<string, string>));
    calls.push({ url: String(url), headers, body: JSON.parse(String(options?.body ?? "null")) });
    // Two commands per window; the count is the first of each pair.
    const results = counts.flatMap((n) => [{ result: n }, { result: 1 }]);
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => (hasBody ? init!.body : results),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const opts = (impl: typeof fetch, now = 1_760_000_000_000) => ({ url: URL_BASE, token: TOKEN, now, fetchImpl: impl });

async function main() {
  {
    section("the key carries its own window, which is what makes a fixed window correct");

    const now = 1_760_000_000_000;
    const [incr, expire] = windowCommands("p", "1.2.3.4", now, HOUR);
    check("it INCRs then EXPIREs", incr[0] === "INCR" && expire[0] === "EXPIRE", JSON.stringify([incr, expire]));
    check("both touch the same key", incr[1] === expire[1], JSON.stringify([incr[1], expire[1]]));
    check("the TTL is the window length", expire[2] === "3600", String(expire[2]));
    check("the window length is in the key", incr[1].includes(":3600:"), incr[1]);
    check("and the identifier", incr[1].endsWith(":1.2.3.4"), incr[1]);
    check("and the prefix leads", incr[1].startsWith("p:"), incr[1]);

    // THE reason the TTL can be re-set on every increment without extending
    // the window: the bucket number is part of the key, so the next window
    // is a different key that starts from zero.
    const sameWindow = windowCommands("p", "1.2.3.4", now + 60_000, HOUR);
    check("a minute later is the same bucket", sameWindow[0][1] === incr[1], sameWindow[0][1]);
    const nextWindow = windowCommands("p", "1.2.3.4", now + 3_600_000, HOUR);
    check("an hour later is a different one", nextWindow[0][1] !== incr[1], nextWindow[0][1]);

    // Two callers must never share a bucket.
    const other = windowCommands("p", "5.6.7.8", now, HOUR);
    check("a different identifier is a different key", other[0][1] !== incr[1], other[0][1]);
    // And two windows of the same caller must not collide, or the hourly
    // count would be the daily count.
    const day = windowCommands("p", "1.2.3.4", now, DAY);
    check("a different window is a different key", day[0][1] !== incr[1], day[0][1]);
  }

  {
    section("what goes over the wire");

    const { impl, calls } = fakeFetch([1, 1]);
    await checkEdgeLimit("ratelimit:admin-auth", "1.2.3.4", [HOUR, DAY], opts(impl));
    check("one round-trip for both windows", calls.length === 1, String(calls.length));
    check("to the pipeline endpoint", calls[0].url === `${URL_BASE}/pipeline`, calls[0].url);
    check("with the bearer token", calls[0].headers.Authorization === `Bearer ${TOKEN}`, JSON.stringify(calls[0].headers));
    check("and four commands - INCR+EXPIRE per window", Array.isArray(calls[0].body) && (calls[0].body as unknown[]).length === 4, JSON.stringify(calls[0].body));

    // A trailing slash on the configured URL must not produce "//pipeline".
    const trailing = fakeFetch([1, 1]);
    await checkEdgeLimit("p", "ip", [HOUR], { url: `${URL_BASE}/`, token: TOKEN, fetchImpl: trailing.impl });
    check("a trailing slash on the URL is handled", trailing.calls[0].url === `${URL_BASE}/pipeline`, trailing.calls[0].url);
  }

  {
    section("counting");

    const under = await checkEdgeLimit("p", "ip", [HOUR], opts(fakeFetch([1]).impl));
    check("the first attempt is allowed", under.allowed === true, JSON.stringify(under));

    const atLimit = await checkEdgeLimit("p", "ip", [HOUR], opts(fakeFetch([HOUR.limit]).impl));
    check("the tenth is allowed - the limit is an allowance, not a ceiling to stop below", atLimit.allowed === true, JSON.stringify(atLimit));

    const over = await checkEdgeLimit("p", "ip", [HOUR], opts(fakeFetch([HOUR.limit + 1]).impl));
    check("the eleventh is not", over.allowed === false, JSON.stringify(over));
    check("  and it names the window that ran out", over.exceeded === "3600s", String(over.exceeded));

    // Both windows are checked, so pacing just under the hourly limit
    // cannot dodge the daily one - the same property lib/ratelimit.ts's own
    // comment claims for its two sliding windows.
    const dayOnly = await checkEdgeLimit("p", "ip", [HOUR, DAY], opts(fakeFetch([1, DAY.limit + 1]).impl));
    check("the daily cap bites even when the hourly is clear", dayOnly.allowed === false, JSON.stringify(dayOnly));
    check("  and says which", dayOnly.exceeded === "86400s", String(dayOnly.exceeded));

    const bothClear = await checkEdgeLimit("p", "ip", [HOUR, DAY], opts(fakeFetch([3, 12]).impl));
    check("both clear is allowed", bothClear.allowed === true, JSON.stringify(bothClear));
  }

  {
    section("every failure refuses - the property this limiter exists for");

    // Unconfigured. A deployment with no Redis cannot count, and "cannot
    // count" must not read as "unlimited" on a credential gate.
    const noUrl = await checkEdgeLimit("p", "ip", [HOUR], { url: null, token: TOKEN, fetchImpl: fakeFetch([1]).impl });
    check("no Upstash URL refuses", noUrl.allowed === false, JSON.stringify(noUrl));
    check("  and says so", noUrl.exceeded === "unconfigured", String(noUrl.exceeded));
    const noToken = await checkEdgeLimit("p", "ip", [HOUR], { url: URL_BASE, token: null, fetchImpl: fakeFetch([1]).impl });
    check("no token refuses", noToken.allowed === false, JSON.stringify(noToken));
    const noWindows = await checkEdgeLimit("p", "ip", [], opts(fakeFetch([]).impl));
    check("no windows refuses rather than allowing everything", noWindows.allowed === false, JSON.stringify(noWindows));

    // A 500, a 401 (wrong token), a 429 from Upstash itself.
    for (const status of [400, 401, 429, 500, 503]) {
      const res = await checkEdgeLimit("p", "ip", [HOUR], opts(fakeFetch([1], { ok: false, status }).impl));
      check(`HTTP ${status} refuses`, res.allowed === false, JSON.stringify(res));
      check(`  and records the status`, res.exceeded === `http-${status}`, String(res.exceeded));
    }

    // Unreachable, and a timeout, which is the same path.
    const thrower = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const unreachable = await checkEdgeLimit("p", "ip", [HOUR], opts(thrower));
    check("an unreachable counter refuses", unreachable.allowed === false, JSON.stringify(unreachable));
    check("  and says unreachable", unreachable.exceeded === "unreachable", String(unreachable.exceeded));

    const abort = (async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    }) as unknown as typeof fetch;
    check("a timeout refuses", (await checkEdgeLimit("p", "ip", [HOUR], opts(abort))).allowed === false);

    // A body that is not the expected shape. Any of these would otherwise
    // read as "count is not a number", which must never mean "fine".
    for (const [name, body] of [
      ["an object", { result: 1 }],
      ["null", null],
      ["a string", "OK"],
      ["a number", 1],
      ["an empty array", []],
      ["results with no result field", [{}, {}]],
      ["a string count", [{ result: "1" }, { result: 1 }]],
      ["a null count", [{ result: null }, { result: 1 }]],
      ["an error entry", [{ error: "WRONGTYPE" }, { result: 1 }]],
    ] as [string, unknown][]) {
      const res = await checkEdgeLimit("p", "ip", [HOUR], opts(fakeFetch([1], { body }).impl));
      check(`${name} refuses`, res.allowed === false, JSON.stringify(res));
    }

    // json() itself throwing - a truncated body.
    const badJson = (async () =>
      ({ ok: true, status: 200, json: async () => JSON.parse("{") }) as unknown as Response) as unknown as typeof fetch;
    check("an unparseable body refuses", (await checkEdgeLimit("p", "ip", [HOUR], opts(badJson))).allowed === false);

    // And the second window's count being unreadable must refuse too, not
    // just the first - a loop that only checked results[0] would pass this.
    const secondBad = await checkEdgeLimit("p", "ip", [HOUR, DAY], opts(fakeFetch([1], { body: [{ result: 1 }, { result: 1 }] }).impl));
    check("a missing second window refuses", secondBad.allowed === false, JSON.stringify(secondBad));
  }

  finish();
}

main();
