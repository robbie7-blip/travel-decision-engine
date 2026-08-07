// decide's answer to a Booking.com-style "why trust us" footer strip — but
// built from claims the app can actually back up (the confidence-tier
// system already shown on every itinerary item) rather than partner logos
// or certifications it doesn't have. Deliberately reuses tierLegend and
// result.tierExplainer instead of writing new copy, so this can never drift
// from what the item-level evidence toggle actually says.

import { ConfidenceDot } from "./ui";
import type { Dictionary } from "@/lib/i18n";
import type { ConfidenceTier } from "@/lib/types";

const TIERS: ConfidenceTier[] = ["verified", "fact_grounded", "single_source", "conflicting", "inferred"];

export function TrustFooter({ t }: { t: Dictionary }) {
  return (
    <div style={{ padding: "40px 24px", background: "var(--bg-panel-raised)", borderTop: "1px solid var(--line)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h2 className="font-display" style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px", color: "var(--brand-teal)" }}>
          {t.trustFooter.heading}
        </h2>
        <p style={{ color: "var(--ink-dim)", fontSize: 14, lineHeight: 1.6, maxWidth: 620, margin: "0 0 24px" }}>
          {t.trustFooter.intro}
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {TIERS.map((tier) => (
            <div
              key={tier}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                background: "var(--bg-panel)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <div style={{ marginTop: 2 }}>
                <ConfidenceDot tier={tier} />
              </div>
              <div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--ink)",
                    marginBottom: 2,
                  }}
                >
                  {t.tierLegend[tier]}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                  {t.result.tierExplainer[tier]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
