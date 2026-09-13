// Offline support, scoped to the one thing that actually needs it: a
// finished itinerary, on the trip, with no signal.
//
// WHAT THIS REPLACES, because it matters more than what it adds. The
// previous version was eleven lines and described itself as existing
// "mainly to satisfy PWA installability". It intercepted every GET and
// cache.put the response, unconditionally. That meant CacheStorage on the
// device accumulated:
//
//   - /api/account - the signed-in email, plan and subscription status;
//   - /api/job/<id> - the whole job, brief included, and the brief carries
//     mobility_constraints, which is a disability disclosure;
//   - /admin/health - which of the deployment's credentials are set.
//
// None of it was ever cleared, including on sign-out, and no Cache-Control
// header prevents it: the Cache API does not honour no-store. On a shared
// or lost device that is a real disclosure, and it was the side effect of a
// service worker whose stated purpose was an install prompt.
//
// It also had a second, quieter fault: every failed request fell back to
// `caches.match("/")`. A failed /api/rates therefore resolved with the
// HOMEPAGE HTML rather than failing, so `res.json()` threw somewhere that
// was written to expect a network error. A masked failure is worse than a
// failure.
//
// So this version inverts the default. Nothing is cached unless it is named
// here, and three things are named:
//
//   1. THE APP SHELL and Next's content-hashed static chunks. Without the
//      chunks an offline trip page loads its HTML and no JavaScript, and
//      since /trip/[jobId] renders <TripView> which fetches the itinerary
//      client-side, the page would be a permanent empty shell. The chunks
//      are immutable by URL, so cache-first is correct for them.
//   2. A FINISHED JOB's JSON, which is the itinerary itself.
//   3. THE TRIP PAGE's HTML, so the URL resolves at all when the network
//      does not.
//
// Everything private is not merely uncached - it is not intercepted, so
// there is no code path that could put it in a cache by accident.
//
// Bumping SHELL_CACHE to v2 is also the migration: activate deletes every
// cache whose name is not current, which is what clears whatever the old
// worker collected on devices that already have it.

const SHELL_CACHE = "decide-shell-v2";
const TRIP_CACHE = "decide-trips-v1";

const SHELL_URLS = ["/", "/icon.svg", "/logo-icon.svg"];
const CURRENT_CACHES = [SHELL_CACHE, TRIP_CACHE];

/** Trips kept on the device. Each one is two entries (the page and the
 * job JSON), so this is 40 cached responses at most.
 *
 * Capped because a browser evicts a whole origin's storage when it runs
 * short, not the oldest entry in it - an unbounded trip cache would put
 * the itinerary someone needs tomorrow at risk to keep one they generated
 * and abandoned in March. Twenty is far more than anyone has in flight and
 * small enough to be uninteresting to the browser. */
const MAX_CACHED_TRIPS = 20;

/** Paths this worker must never see, let alone store.
 *
 * Account state, auth, payment, the admin surfaces, and the per-user
 * visited/feedback writes. Matched on pathname only - these are all
 * same-origin - and the fetch handler returns without calling respondWith
 * for them, so the browser handles them as if no service worker existed. */
function isPrivate(pathname) {
  return (
    /^\/(admin|account)(\/|$)/.test(pathname) ||
    /^\/api\/(account|auth|admin|billing-portal|checkout|stripe|visited|feedback|stats-share|analytics)(\/|$)/.test(
      pathname
    )
  );
}

/** GET /api/job/<id> - the itinerary. */
function isJobRequest(pathname) {
  return /^\/api\/job\/[^/]+$/.test(pathname);
}

/** /trip/<id> - the page it renders in. */
function isTripPage(pathname) {
  return /^\/trip\/[^/]+$/.test(pathname);
}

/** Next's build output: content-hashed, so a URL's bytes never change. */
function isImmutableAsset(pathname) {
  return pathname.startsWith("/_next/static/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Individually rather than addAll, which rejects the whole batch if
      // any single URL 404s - one renamed icon would leave the worker with
      // no shell at all.
      Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

/** Signing out clears the trips.
 *
 * A trip link is shareable and its contents are not a secret, but the job
 * carries the brief, and the brief carries dietary and mobility notes. The
 * person handing the laptop back has said they are done; leaving their
 * itineraries readable offline afterwards is not what "sign out" means to
 * them. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "decide-clear-trips") {
    event.waitUntil(caches.delete(TRIP_CACHE));
  }
});

/** Drops the oldest entries once the cache is over its cap. cache.keys()
 * returns insertion order, so the front of the list is the oldest. */
async function trimTripCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHED_TRIPS * 2;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

/** Stores a response if it is worth storing, then trims. */
async function keepTrip(request, response) {
  const cache = await caches.open(TRIP_CACHE);
  await cache.put(request, response);
  await trimTripCache(cache);
}

/** The itinerary: network first, and stored only once it is FINISHED.
 *
 * Only "done" is worth keeping. The trip page polls this endpoint every
 * 400ms while generating, so caching every response would store dozens of
 * "running" records per trip and then, offline, hand back a half-finished
 * one - a page that spins forever on a job that completed hours ago. A
 * stalled or errored job is not stored either: it has nothing in it to
 * read on a plane. */
async function handleJobRequest(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const inspect = response.clone();
      // Parsed rather than trusted: this decides whether the bytes are
      // worth keeping, and a body that is not a finished job is not.
      inspect
        .json()
        .then((job) => {
          if (job && job.status === "done" && job.result) {
            return keepTrip(request, response.clone());
          }
          return undefined;
        })
        .catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: TRIP_CACHE });
    if (cached) return cached;
    // A JSON endpoint must fail as a network failure, never as HTML. The
    // previous worker answered every miss with the homepage, so the
    // caller's res.json() threw inside code written to handle a fetch
    // rejection.
    return Response.error();
  }
}

/** The trip page itself: network first, cached copy when there is no
 * network, and the app shell as the last resort so the URL at least opens
 * to something rather than the browser's offline error. */
async function handleTripPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await keepTrip(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: TRIP_CACHE });
    if (cached) return cached;
    const shell = await caches.match("/", { cacheName: SHELL_CACHE });
    return shell ?? Response.error();
  }
}

/** Content-hashed build output: cache first, because the bytes behind a
 * given URL cannot change, and because this is what makes an offline trip
 * page able to run at all. */
async function handleImmutableAsset(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/** The shell: network first so a deploy is picked up immediately, cache
 * only when the network fails. */
async function handleShell(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE });
    return cached ?? (await caches.match("/", { cacheName: SHELL_CACHE })) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Same-origin only. A cross-origin request (Wikipedia summaries, Google
  // photo bytes, Stripe) is somebody else's cache policy, and an opaque
  // response cannot even be inspected before storing.
  if (url.origin !== self.location.origin) return;

  // Not intercepted at all - see isPrivate. There is deliberately no
  // branch below that could reach a cache with one of these.
  if (isPrivate(url.pathname)) return;

  if (isJobRequest(url.pathname)) {
    event.respondWith(handleJobRequest(request));
    return;
  }
  if (isTripPage(url.pathname)) {
    event.respondWith(handleTripPage(request));
    return;
  }
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(handleImmutableAsset(request));
    return;
  }
  // Everything else that is a page or a shell asset. Other API routes fall
  // here and are fetched normally: handleShell caches on success, so they
  // would be stored - which is why the ones that must not be are excluded
  // above by path rather than by guessing from the response.
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(handleShell(request));
});
