"use client";

// Shows a finished job's stage timings on the trip page, to the site owner
// only. This exists because generation latency has now been diagnosed
// several times by reasoning from the code about which stage *should*
// dominate - and been wrong more than once, each time costing a deploy
// cycle and a round trip to find out. The worker has always logged these
// numbers; the problem was that reading them meant shell access to the
// worker host, so in practice they went unread and the guessing continued.
//
// Putting them on the page the owner is already looking at, right after the
// run they just did, makes the answer a glance instead of an investigation.
// Visibility is driven by the same localStorage flag as AddToShowcaseButton
// (see lib/adminUi.ts) - set by visiting any /admin/* page, never shown to
// a real traveler, and never requiring a probe of a protected endpoint.

import { useEffect, useState } from "react";
import { isAdminUi } from "@/lib/adminUi";
import type { JobTimings as Timings, QualityReport } from "@/lib/jobs";

function secs(ms?: number): string {
  return ms == null ? "-" : `${(ms / 1000).toFixed(1)}s`;
}

export function JobTimings({ timings, quality }: { timings?: Timings; quality?: QualityReport }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(isAdminUi());
  }, []);
  if (!visible || (!timings && !quality)) return null;

  const fellBack = timings?.fellBackToSingleCall;

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
      {/* The verdict first. Everything below it is detail explaining how
          the run got there, and on a run that passed there is nothing to
          investigate - so the one line that says whether to look further
          goes at the top. */}
      {quality && (
        <div style={{ color: quality.passed ? "var(--accent-green)" : "var(--infeasible)", fontWeight: 700 }}>
          {quality.passed ? "✓ QUALITY PASS" : `✗ ${quality.defectCount} DEFECT(S)`}
          {quality.warningCount > 0 ? ` · ${quality.warningCount} warning(s)` : ""} ·{" "}
          {quality.groundedPercent}% grounded across {quality.itemCount} items
        </div>
      )}
      {quality && quality.findings.length > 0 && (
        <ul style={{ margin: "2px 0 6px", paddingLeft: 16, color: "var(--ink-soft)" }}>
          {quality.findings.map((f, i) => (
            <li
              key={`${f.check}-${f.day ?? "trip"}-${i}`}
              style={{ color: f.severity === "defect" ? "var(--infeasible)" : "var(--unverified)" }}
            >
              {f.detail}
              <span style={{ color: "var(--ink-dim)" }}> ({f.check})</span>
            </li>
          ))}
        </ul>
      )}

      {timings && (
        <>
          <div style={{ color: "var(--ink)", fontWeight: 700 }}>
            generation {secs(timings.totalMs)}
          </div>
          <div>
            accommodation lookup{" "}
            {/* A dash here read as "broken" rather than "we stopped waiting":
                when the wait is abandoned the lookup is still running when
                the job record is written, so its duration genuinely is not
                known - and that is the one line a reader checks first after
                a slow generation. */}
            {timings.lodgingPrefetchMs == null && timings.accommodationWaitAbandoned
              ? "(abandoned)"
              : secs(timings.lodgingPrefetchMs)}{" "}
            · generate {secs(timings.generateMs)} · verify{" "}
            {secs(timings.venuesAndFlightsMs)} · repairs {secs(timings.repairsMs)} · re-verify{" "}
            {secs(timings.verifyRepairsMs)}
          </div>
          <div>
            phase 1 ({timings.waitedForFrame ? "plan + frame ⚠ accommodation came back short" : "plan only, frame ran alongside days"}){" "}
            {secs(timings.skeletonMs)}
            {/* The halves, separately. skeletonMs is the MAX of plan, frame
                and the accommodation lookup, so on its own it cannot say
                which of them to fix - the first measured 58.5s run showed
                29.2s here and 29.2s for the lookup, leaving the frame's own
                timing unknown and the fix unguessable. */}
            {(timings.planMs != null || timings.frameMs != null) && (
              <span style={{ color: "var(--ink-dim)" }}>
                {" "}(plan {secs(timings.planMs)}, frame {secs(timings.frameMs)})
              </span>
            )}{" "}
            · {timings.dayCount ?? "-"} day(s){" "}
            {secs(timings.daysMs)}
            {timings.dayWaves != null && (
              // Anything above 1 means the day calls didn't all run at once,
              // so phase 2 paid for its slowest day more than once. It reads
              // as "the days were slow" in the number next to it, which is
              // exactly how it went unnoticed for weeks - so it's called out.
              <span style={{ color: timings.dayWaves > 1 ? "var(--infeasible)" : "var(--ink-dim)" }}>
                {" "}
                in {timings.dayWaves} wave{timings.dayWaves === 1 ? "" : "s"}
                {timings.dayWaves > 1 ? " ⚠ raise MAX_PARALLEL_DAYS" : ""}
              </span>
            )}
          </div>
          {/* Which half of the accommodation lookup came back empty, and what it
              cost. A missing rate is the expensive one: it is what puts the
              frame on the critical path above, and the two used to be
              indistinguishable from here. */}
          {/* Every silent retry, named. Each is a whole extra model call,
              and until now a retried stage just read as a slow one - the
              102.4s run showed "plan 68.8s, frame 31.6s" with no way to see
              that 68.8s was two calls. */}
          {timings.retries && Object.keys(timings.retries).length > 0 && (
            <div style={{ color: "var(--infeasible)", marginTop: 4 }}>
              ⚠ retried:{" "}
              {Object.entries(timings.retries)
                .map(([label, n]) => `${label}${n > 1 ? ` x${n}` : ""}`)
                .join(", ")}{" "}
              - each retry is a whole extra model call and doubles that stage
            </div>
          )}
          {/* Distinct from the lines below: this means the lookup had NOT
              answered yet and phase 2 stopped holding the trip open for it,
              rather than answering and coming back empty. */}
          {timings.accommodationWaitAbandoned && (
            <div style={{ color: "var(--unverified)", marginTop: 4 }}>
              ⚠ stopped waiting for the accommodation lookup once the frame was ready - used the
              frame&rsquo;s estimate
            </div>
          )}
          {timings.lodgingShort?.map((s) => (
            <div
              key={`${s.city}-${s.missing}`}
              style={{ color: s.missing === "rate" ? "var(--infeasible)" : "var(--unverified)", marginTop: 4 }}
            >
              ⚠ {s.city}: accommodation {s.missing === "rate" ? "price" : "property"} came back empty after a retry
              {s.missing === "rate"
                ? " - this is what made phase 1 wait for the frame"
                : " - accommodation fell back to a generic line"}
            </div>
          ))}
          {fellBack && (
            <div style={{ color: "var(--infeasible)", marginTop: 4 }}>
              ⚠ FELL BACK to single-call generation - this is the slow path.
              <div style={{ color: "var(--ink-soft)", wordBreak: "break-word" }}>
                {timings.fallbackReason}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
