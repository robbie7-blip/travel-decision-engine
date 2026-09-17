"use client";

import type { Dictionary } from "@/lib/i18n";
// Shared with TripBuilding, which is what the trip page actually renders -
// see lib/useCityFacts.ts for why the rotation moved out of this file.
import { useCityFacts, useRotatingIndex } from "@/lib/useCityFacts";

/** Shown while a trip (or one side of a comparison) is generating - replaces
 * the old bare status text with a spinner + card so the wait feels designed
 * rather than stalled. `message` is the live rotating status line from
 * useJobStatusMessage. `destinations` and `t` are optional - when both are
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
          // Was coral over gold, from the palette this design left behind.
          // The spinner itself stays a circle - that is what a spinner is,
          // not the decorative motif the redesign removed.
          borderTopColor: "var(--brand-teal)",
          borderRightColor: "var(--brand-gold)",
          animation: "decide-spin 0.8s linear infinite",
        }}
      />
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
