"use client";

// Shows a finished job's stage timings on the trip page, to the site owner
// only. This exists because generation latency has now been diagnosed
// several times by reasoning from the code about which stage *should*
// dominate — and been wrong more than once, each time costing a deploy
// cycle and a round trip to find out. The worker has always logged these
// numbers; the problem was that reading them meant shell access to the
// worker host, so in practice they went unread and the guessing continued.
//
// Putting them on the page the owner is already looking at, right after the
// run they just did, makes the answer a glance instead of an investigation.
// Visibility is driven by the same localStorage flag as AddToShowcaseButton
// (see lib/adminUi.ts) — set by visiting any /admin/* page, never shown to
// a real traveler, and never requiring a probe of a protected endpoint.

import { useEffect, useState } from "react";
import { isAdminUi } from "@/lib/adminUi";
import type { JobTimings as Timings } from "@/lib/jobs";

function secs(ms?: number): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

export function JobTimings({ timings }: { timings?: Timings }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(isAdminUi());
  }, []);
  if (!visible || !timings) return null;

  const fellBack = timings.fellBackToSingleCall;

  return (
    <div
      className="font-mono"
      style={{
        marginTop: 12,
        padding: "10px 12px",
        border: `1px solid ${fellBack ? "var(--infeasible)" : "var(--line)"}`,
        borderRadius: 8,
        background: "var(--bg-panel-raised)",
        fontSize: 11,
        lineHeight: 1.7,
        color: "var(--ink-soft)",
      }}
    >
      <div style={{ color: "var(--ink)", fontWeight: 700 }}>
        generation {secs(timings.totalMs)}
      </div>
      <div>
        lodging prefetch {secs(timings.lodgingPrefetchMs)} · generate {secs(timings.generateMs)} · venues+flights{" "}
        {secs(timings.venuesAndFlightsMs)}
      </div>
      <div>
        skeleton {secs(timings.skeletonMs)} · {timings.dayCount ?? "—"} day(s) {secs(timings.daysMs)}
      </div>
      {fellBack && (
        <div style={{ color: "var(--infeasible)", marginTop: 4 }}>
          ⚠ FELL BACK to single-call generation — this is the slow path.
          <div style={{ color: "var(--ink-soft)", wordBreak: "break-word" }}>{timings.fallbackReason}</div>
        </div>
      )}
    </div>
  );
}
