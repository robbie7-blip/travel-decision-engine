"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

interface CityFactsResponse {
  facts: string[];
}

/** Self-fetches trivia for the given destinations from /api/city-facts —
 * curated facts/*.json when the city is one of the ~24 hand-verified ones,
 * a live Wikipedia summary otherwise, so every possible destination has
 * something to show, not just the curated set. */
function useCityFacts(destinations?: string[]): string[] {
  const [facts, setFacts] = useState<string[]>([]);
  const key = destinations?.join(",") ?? "";

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    fetch(`/api/city-facts?destinations=${encodeURIComponent(key)}`)
      .then((res) => res.json())
      .then((data: CityFactsResponse) => {
        if (!cancelled) setFacts(data.facts ?? []);
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

function useRotatingIndex(length: number): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % length), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [length]);

  return length > 0 ? index % length : 0;
}

/** Shown while a trip (or one side of a comparison) is generating — replaces
 * the old bare status text with a spinner + card so the wait feels designed
 * rather than stalled. `message` is the live rotating status line from
 * useJobStatusMessage. `destinations` and `t` are optional — when both are
 * given, a rotating "Did you know?" fact about the destination(s) is shown
 * below the status line so the wait feels productive instead of dead time. */
export function LoadingScreen({
  message,
  destinations,
  t,
}: {
  message: string;
  destinations?: string[];
  t?: Dictionary;
}) {
  const facts = useCityFacts(destinations);
  const factIndex = useRotatingIndex(facts.length);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        padding: "48px 24px",
        background: "var(--bg-panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "3px solid var(--line)",
          borderTopColor: "var(--accent-1)",
          borderRightColor: "var(--accent-2)",
          animation: "decide-spin 0.8s linear infinite",
        }}
      />
      <div
        className="font-mono"
        style={{ fontSize: 14, color: "var(--ink-dim)", textAlign: "center" }}
      >
        {message}
      </div>
      {t && facts.length > 0 && (
        <div
          style={{
            marginTop: 4,
            paddingTop: 20,
            borderTop: "1px solid var(--line)",
            maxWidth: 420,
            textAlign: "center",
          }}
        >
          <div
            className="font-mono"
            style={{ fontSize: 11, letterSpacing: "0.04em", color: "var(--ink-soft)", marginBottom: 6 }}
          >
            {t.trip.didYouKnow}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>{facts[factIndex]}</div>
        </div>
      )}
    </div>
  );
}
