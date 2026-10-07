"use client";

import type { Dictionary } from "@/lib/i18n";
// Shared with TripBuilding, which is what the trip page actually renders -
// see lib/useCityFacts.ts for why the rotation moved out of this file.
import { useCityFacts, useRotatingIndex } from "@/lib/useCityFacts";
import { ThinkingMark } from "./ThinkingMark";

/** Shown while a trip (or one side of a comparison) is generating - replaces
 * the old bare status text with a card so the wait feels designed rather
 * than stalled. `message` is the live rotating status line from
 * useJobStatusMessage. `destinations` and `t` are optional - when both are
 * given, a rotating "Did you know?" fact about the destination(s) is shown
 * below the status line so the wait feels productive instead of dead time.
 *
 * THE SAME INDICATOR AS EVERYWHERE ELSE. This used to be a two-tone ring
 * spinning on `decide-spin`, written long before Ask a Local and pushback
 * got the mark that pulses (components/ThinkingMark.tsx). That left the
 * product saying "working on it" in two unrelated visual languages, with
 * the generic one on the longest wait it has - fifty to seventy seconds,
 * against a few for a question. A ring is what every website spins; the
 * mark is this one's. */
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
      {/* Much bigger than the 20px it renders at inline. This one has a whole
          card to itself and a minute to fill, where the inline ones sit
          beside a line of text. */}
      <ThinkingMark size={58} />
      <div
        className="font-ui"
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
            className="font-ui"
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
