"use client";

// The "did you know" rotation, shared by both things that render a wait.
//
// It lived inside LoadingScreen, which is the component the trip page
// STOPPED using: TripBuilding replaced it so the wait could show the real
// outline as phase 1 and each day land. But the outline does not exist for
// the first twenty seconds of a generation, so those twenty seconds became
// a title and one status line - the exact dead time the facts were added to
// fill. The rotation was not removed on purpose; it was left behind in a
// component nothing renders any more.
//
// So it lives here and both use it.

import { useEffect, useState } from "react";

interface CityFactsResponse {
  facts: string[];
}

/** Self-fetches trivia for the given destinations from /api/city-facts -
 * curated facts/*.json when the city is one of the ~24 hand-verified ones,
 * a live Wikipedia summary otherwise, so every possible destination has
 * something to show, not just the curated set. */
export function useCityFacts(destinations?: string[]): string[] {
  const [facts, setFacts] = useState<string[]>([]);
  const key = destinations?.join(",") ?? "";

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    fetch(`/api/city-facts?destinations=${encodeURIComponent(key)}`)
      .then((res) => res.json())
      .then((data: CityFactsResponse) => {
        // Validated, not asserted: this is a network payload read straight
        // into a render, and `data.facts.length` on a body without the key
        // is a throw on the page somebody is waiting on.
        if (cancelled) return;
        const list = Array.isArray(data?.facts) ? data.facts.filter((f): f is string => typeof f === "string") : [];
        setFacts(list);
      })
      .catch(() => {
        if (!cancelled) setFacts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return facts;
}

const ROTATE_INTERVAL_MS = 6000;

export function useRotatingIndex(length: number): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % length), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [length]);

  return length > 0 ? index % length : 0;
}
