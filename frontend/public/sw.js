// Minimal service worker: exists mainly to satisfy PWA installability
// (Chrome requires a registered SW with a fetch handler) and to keep a
// totally-offline visit from hitting a blank browser error instead of the
// app shell. This product is fundamentally dynamic (live search + LLM
// calls) — there's no meaningful "offline itinerary generation" — so this
// deliberately stays network-first with a cache fallback, not an offline-
// first strategy.
const CACHE_NAME = "decide-shell-v1";
const SHELL_URLS = ["/", "/icon.svg", "/logo-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match("/")))
  );
});
