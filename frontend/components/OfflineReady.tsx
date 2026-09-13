"use client";

// Whether this trip will open without a signal - checked, not claimed.
//
// The itinerary is used ON the trip, which is exactly where the data is
// roaming, the hotel wifi is a captive portal, and the phone is at 12%.
// The service worker stores a finished trip so the page works anyway (see
// public/sw.js), but a capability nobody is told about is a capability
// nobody relies on - and this is the one someone would want to verify
// while they still have a connection to fix it with.
//
// So this reads the actual CacheStorage entry rather than inferring it
// from "the service worker registered". Those are different facts: the
// worker only stores a job once it comes back DONE, so a trip watched
// through generation is not saved until its final poll lands, and a
// browser can evict the whole origin's storage when it runs short. A line
// that said "saved" because a worker existed would be the kind of
// confident, wrong reassurance this product tries not to produce.

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

/** Must match TRIP_CACHE in public/sw.js. */
const TRIP_CACHE = "decide-trips-v1";

type State = "unknown" | "saved" | "not-saved" | "offline-saved";

export function OfflineReady({ jobId, t }: { jobId: string; t: Dictionary }) {
  const [state, setState] = useState<State>("unknown");

  useEffect(() => {
    let cancelled = false;

    async function look() {
      // Every one of these can be absent or throw: no service worker in
      // this browser, CacheStorage unavailable in a private window,
      // storage blocked. All of them mean the same thing to the traveller
      // - we cannot promise this works offline - so they all land on
      // "unknown", which renders nothing at all rather than a guess.
      try {
        if (typeof caches === "undefined" || !("serviceWorker" in navigator)) return;
        const cache = await caches.open(TRIP_CACHE);
        const hit = await cache.match(`/api/job/${jobId}`);
        if (cancelled) return;
        if (!hit) {
          setState(navigator.onLine === false ? "unknown" : "not-saved");
          return;
        }
        setState(navigator.onLine === false ? "offline-saved" : "saved");
      } catch {
        // Leave it unknown.
      }
    }

    // Twice, a beat apart. The service worker writes the entry while
    // handling the very response that rendered this component, so a single
    // check on mount races it and reports "not saved" for a trip that is
    // saved a moment later. One retry is enough and costs nothing; a
    // poller would be a timer running for the life of the page to answer
    // a question that stops changing.
    void look();
    const retry = setTimeout(() => void look(), 1500);

    const onOnline = () => void look();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, [jobId]);

  if (state === "unknown") return null;

  // Offline and reading the stored copy is the one case that deserves to
  // interrupt: it explains why nothing is loading and confirms that what
  // is on screen is real.
  const offline = state === "offline-saved";
  const label = offline
    ? t.result.offlineShowingSaved
    : state === "saved"
      ? t.result.offlineSaved
      : t.result.offlineNotSaved;

  return (
    <div
      className="font-ui"
      style={{
        marginBottom: 20,
        fontSize: 11,
        color: offline ? "var(--unverified)" : "var(--ink-soft)",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span aria-hidden>{state === "not-saved" ? "○" : "●"}</span>
      <span>{label}</span>
    </div>
  );
}
