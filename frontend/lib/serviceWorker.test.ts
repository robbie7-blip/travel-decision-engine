// The service worker's routing rules, against the file that actually ships.
//
// public/sw.js is not a module and cannot be imported, so this reads it off
// disk, runs it with a stubbed `self` and `caches`, captures the listeners
// it registers, and drives its real fetch handler. That matters here more
// than usual: a service worker is the one piece of this product that keeps
// running after a deploy, on a device nobody can inspect, and its previous
// version was eleven lines that quietly stored things it should never have
// touched.
//
// WHAT WENT WRONG. The old worker intercepted every GET and cache.put the
// response, unconditionally. So CacheStorage on the device accumulated
// /api/account (email, plan, subscription status), /api/job/<id> (the whole
// job, and the brief inside it carries mobility_constraints - a disability
// disclosure), and /admin/health (which of the deployment's credentials are
// set). None of it was ever cleared, including on sign-out, and no header
// prevents it: the Cache API does not honour no-store.
//
// It also answered every failed request with `caches.match("/")`, so a
// failed /api/rates resolved with the HOMEPAGE HTML instead of failing -
// and the caller's res.json() threw inside code written to handle a
// network error. A masked failure is worse than a failure.
//
// The two load-bearing assertions below are therefore: private paths are
// NOT INTERCEPTED AT ALL (not merely uncached - there is no code path that
// could reach a cache with them), and a finished trip is stored while a
// running one is not.
//
// Run: npm run test:service-worker

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, finish, heading, section } from "./testutil";

heading("service worker");

const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

interface Listeners {
  fetch?: (event: FakeEvent) => void;
  install?: (event: FakeEvent) => void;
  activate?: (event: FakeEvent) => void;
  message?: (event: FakeEvent) => void;
}

interface FakeEvent {
  request?: Request;
  data?: unknown;
  respondWith: (p: Promise<Response>) => void;
  waitUntil: (p: Promise<unknown>) => void;
}

/** One cache, with just the methods sw.js uses. Records insertion order,
 * because the trim logic depends on cache.keys() returning it. */
function makeCache() {
  const entries: { url: string; response: Response }[] = [];
  return {
    entries,
    async put(request: Request | string, response: Response) {
      const url = typeof request === "string" ? request : request.url;
      const existing = entries.findIndex((e) => e.url === url);
      if (existing >= 0) entries.splice(existing, 1);
      entries.push({ url, response });
    },
    async match(request: Request | string) {
      const url = typeof request === "string" ? new URL(request, "https://d.test").href : request.url;
      return entries.find((e) => e.url === url)?.response;
    },
    async keys() {
      return entries.map((e) => ({ url: e.url }) as Request);
    },
    async delete(request: Request | string) {
      const url = typeof request === "string" ? request : request.url;
      const i = entries.findIndex((e) => e.url === url);
      if (i >= 0) entries.splice(i, 1);
      return i >= 0;
    },
    async add(url: string) {
      entries.push({ url, response: new Response("shell") });
    },
  };
}

type FakeCache = ReturnType<typeof makeCache>;

/** Loads sw.js into a fresh sandbox. `netFail` makes every fetch reject,
 * which is what being offline looks like from inside a worker. */
function load(options: { netFail?: boolean; body?: unknown; ok?: boolean } = {}) {
  const listeners: Listeners = {};
  const caches: Record<string, FakeCache> = {};
  const fetched: string[] = [];

  const cachesApi = {
    async open(name: string) {
      caches[name] = caches[name] ?? makeCache();
      return caches[name];
    },
    async keys() {
      return Object.keys(caches);
    },
    async delete(name: string) {
      const had = name in caches;
      delete caches[name];
      return had;
    },
    async match(request: Request | string, opts?: { cacheName?: string }) {
      if (opts?.cacheName) return caches[opts.cacheName]?.match(request);
      for (const cache of Object.values(caches)) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const fakeFetch = async (request: Request | string) => {
    fetched.push(typeof request === "string" ? request : request.url);
    if (options.netFail) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(options.body ?? { ok: true }), {
      status: options.ok === false ? 500 : 200,
      headers: { "content-type": "application/json" },
    });
  };

  const self = {
    addEventListener(type: string, handler: (event: FakeEvent) => void) {
      (listeners as Record<string, unknown>)[type] = handler;
    },
    location: { origin: "https://d.test" },
    skipWaiting() {},
    clients: { claim: async () => undefined },
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", "caches", "fetch", "Response", "URL", SOURCE)(self, cachesApi, fakeFetch, Response, URL);

  return { listeners, caches, fetched };
}

/** Drives the fetch handler and reports whether the worker took the
 * request over at all. */
async function request(
  env: ReturnType<typeof load>,
  url: string,
  method = "GET"
): Promise<{ intercepted: boolean; response?: Response; error?: unknown }> {
  let promise: Promise<Response> | undefined;
  const event: FakeEvent = {
    request: new Request(new URL(url, "https://d.test").href, { method }),
    respondWith: (p) => {
      promise = p;
    },
    waitUntil: () => {},
  };
  env.listeners.fetch?.(event);
  if (!promise) return { intercepted: false };
  try {
    return { intercepted: true, response: await promise };
  } catch (error) {
    return { intercepted: true, error };
  }
}

/** Lets the worker's un-awaited cache writes settle. It inspects a
 * response body before deciding to store it, which is inherently a tick or
 * two behind returning that response. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function main() {
  section("private paths are never even intercepted");

  {
    // Not "cached but harmless" - not touched. The point is that there is
    // no branch in the worker that could reach a cache with one of these.
    const env = load();
    for (const path of [
      "/api/account",
      "/api/auth/verify?token=abc",
      "/api/auth/logout",
      "/api/admin/showcase",
      "/api/billing-portal",
      "/api/checkout",
      "/api/stripe/webhook",
      "/api/visited",
      "/api/visited/share",
      "/api/feedback",
      "/api/stats-share/abc",
      "/api/analytics/funnel",
      "/admin",
      "/admin/health",
      "/admin/stats",
      "/account",
      "/account/visited",
    ]) {
      const r = await request(env, path);
      check(`${path} is left to the browser`, r.intercepted === false);
    }
    await settle();
    const stored = Object.values(env.caches).flatMap((c) => c.entries.map((e) => e.url));
    check("and nothing was stored", stored.length === 0, stored.join(", "));
  }

  {
    // A path that merely starts the same way must still be handled - the
    // rules are anchored, not substring matches.
    const env = load({ body: { id: "x", status: "done", result: {} } });
    check("/accounts-payable is not treated as /account", (await request(env, "/accounts-payable")).intercepted === true);
    check("/administrators is not treated as /admin", (await request(env, "/administrators")).intercepted === true);
  }

  section("a finished trip is stored; a running one is not");

  {
    const env = load({ body: { id: "job-1", status: "done", result: { days: [] } } });
    await request(env, "/api/job/job-1");
    await settle();
    const trips = env.caches["decide-trips-v1"]?.entries.map((e) => e.url) ?? [];
    check("a done job is kept", trips.some((u) => u.endsWith("/api/job/job-1")), trips.join(", "));
  }

  {
    // The page polls this endpoint every 400ms while generating. Caching
    // those would store dozens of half-finished records per trip and then,
    // offline, hand one back - a page spinning on a job that completed
    // hours ago.
    for (const status of ["pending", "running", "error"]) {
      const env = load({ body: { id: "job-1", status, result: { days: [] } } });
      await request(env, "/api/job/job-1");
      await settle();
      const trips = env.caches["decide-trips-v1"]?.entries ?? [];
      check(`a ${status} job is not kept`, trips.length === 0, String(trips.length));
    }
  }

  {
    // "done" with no result is not a readable trip either.
    const env = load({ body: { id: "job-1", status: "done" } });
    await request(env, "/api/job/job-1");
    await settle();
    check("done with no itinerary is not kept", (env.caches["decide-trips-v1"]?.entries ?? []).length === 0);
  }

  {
    const env = load({ body: { id: "job-1", status: "done", result: {} }, ok: false });
    await request(env, "/api/job/job-1");
    await settle();
    check("a 500 is not kept", (env.caches["decide-trips-v1"]?.entries ?? []).length === 0);
  }

  section("offline");

  {
    // The whole point: the trip opens with no network.
    const online = load({ body: { id: "job-1", status: "done", result: { days: [1] } } });
    await request(online, "/api/job/job-1");
    await request(online, "/trip/job-1");
    await settle();

    // Same sandbox, network now failing.
    const offline = load({ netFail: true });
    Object.assign(offline.caches, online.caches);
    const job = await request(offline, "/api/job/job-1");
    check("the stored itinerary is served", job.error === undefined && job.response !== undefined);
    check("and it is the real one", JSON.parse(await (job.response as Response).clone().text()).status === "done");

    const page = await request(offline, "/trip/job-1");
    check("and the page resolves too", page.response !== undefined, String(page.error));
  }

  {
    // A JSON endpoint must fail AS a network failure. The old worker
    // answered every miss with the homepage, so res.json() threw inside
    // code written to handle a rejected fetch.
    const env = load({ netFail: true });
    await env.caches; // no-op, keeps the cache map empty
    const r = await request(env, "/api/job/never-seen");
    const isErrorResponse = r.response?.type === "error" || r.error !== undefined;
    check("an uncached job offline is a network failure, not HTML", isErrorResponse === true, JSON.stringify({ type: r.response?.type }));
  }

  {
    // Other API routes are fetched normally and never stored, so that a
    // failure there stays a failure rather than becoming stale data.
    const env = load();
    check("/api/rates is not intercepted", (await request(env, "/api/rates")).intercepted === false);
    check("/api/weather is not intercepted", (await request(env, "/api/weather?d=Rome")).intercepted === false);
    check("/api/city-facts is not intercepted", (await request(env, "/api/city-facts?destinations=Rome")).intercepted === false);
  }

  section("what else it will and will not touch");

  {
    const env = load();
    check("a POST is ignored", (await request(env, "/trip/job-1", "POST")).intercepted === false);
    check("a cross-origin GET is ignored", (await request(env, "https://maps.example.com/tile.png")).intercepted === false);
    check("the homepage is handled", (await request(env, "/")).intercepted === true);
    check("a build chunk is handled", (await request(env, "/_next/static/chunks/main-abc.js")).intercepted === true);
  }

  {
    // Content-hashed, so a URL's bytes never change - which is why it is
    // cache-first, and why that is safe.
    const env = load();
    await request(env, "/_next/static/chunks/main-abc.js");
    await settle();
    const before = env.fetched.length;
    await request(env, "/_next/static/chunks/main-abc.js");
    check("a cached chunk is not re-fetched", env.fetched.length === before, `${before} -> ${env.fetched.length}`);
  }

  section("the cap, and clearing on sign-out");

  {
    const env = load({ body: { id: "j", status: "done", result: {} } });
    for (let i = 0; i < 30; i++) {
      await request(env, `/api/job/job-${i}`);
      await request(env, `/trip/job-${i}`);
    }
    await settle();
    const count = env.caches["decide-trips-v1"]?.entries.length ?? 0;
    // Twenty trips, each a page and a job record.
    check("the trip cache is capped", count <= 40, String(count));
    check("and it kept the newest", (env.caches["decide-trips-v1"]?.entries ?? []).some((e) => e.url.includes("job-29")));
  }

  {
    // Signing out has to mean the offline copies go too: the brief they
    // carry includes dietary and mobility notes, on a device the person
    // may be handing back.
    const env = load({ body: { id: "job-1", status: "done", result: {} } });
    await request(env, "/api/job/job-1");
    await settle();
    check("there is something to clear", (env.caches["decide-trips-v1"]?.entries ?? []).length > 0);

    let waited: Promise<unknown> | undefined;
    env.listeners.message?.({
      data: { type: "decide-clear-trips" },
      respondWith: () => {},
      waitUntil: (p) => {
        waited = p;
      },
    });
    await waited;
    check("the trip cache is gone after sign-out", env.caches["decide-trips-v1"] === undefined);
  }

  {
    // An unrecognised message must do nothing at all.
    const env = load({ body: { id: "job-1", status: "done", result: {} } });
    await request(env, "/api/job/job-1");
    await settle();
    env.listeners.message?.({ data: { type: "something-else" }, respondWith: () => {}, waitUntil: () => {} });
    await settle();
    check("an unknown message clears nothing", (env.caches["decide-trips-v1"]?.entries ?? []).length > 0);
  }

  section("activate clears whatever the old worker collected");

  {
    // This is the migration. The previous worker's cache was
    // decide-shell-v1 and it held /api/account among other things; bumping
    // the name is what deletes it on devices that already have it.
    const env = load();
    env.caches["decide-shell-v1"] = makeCache();
    env.caches["decide-shell-v2"] = makeCache();
    env.caches["decide-trips-v1"] = makeCache();
    let waited: Promise<unknown> | undefined;
    env.listeners.activate?.({
      respondWith: () => {},
      waitUntil: (p) => {
        waited = p;
      },
    });
    await waited;
    check("the old cache is deleted", env.caches["decide-shell-v1"] === undefined);
    check("the current shell survives", env.caches["decide-shell-v2"] !== undefined);
    check("and so do the trips", env.caches["decide-trips-v1"] !== undefined);
  }

  {
    // The component that tells the traveller whether this worked reads the
    // cache by name, so the two must not drift.
    const component = readFileSync(join(process.cwd(), "components", "OfflineReady.tsx"), "utf8");
    check(
      "OfflineReady and sw.js agree on the cache name",
      component.includes('"decide-trips-v1"') && SOURCE.includes('TRIP_CACHE = "decide-trips-v1"')
    );
    check(
      "and on the message the sign-out sends",
      readFileSync(join(process.cwd(), "app", "account", "page.tsx"), "utf8").includes("decide-clear-trips") &&
        SOURCE.includes('"decide-clear-trips"')
    );
  }

  finish();
}

void main();
