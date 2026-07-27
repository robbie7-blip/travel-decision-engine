import type { CSSProperties, ReactNode } from "react";
import type { ConfidenceTier } from "@/lib/types";

const TIER_COLOR: Record<ConfidenceTier, string> = {
  verified: "var(--grounded)",
  fact_grounded: "var(--grounded)",
  single_source: "var(--tier-single-source)",
  conflicting: "var(--unverified)",
  inferred: "var(--tier-inferred)",
};

export function ConfidenceDot({ tier }: { tier: ConfidenceTier }) {
  return (
    <span
      className={tier === "verified" ? "dot-verified" : undefined}
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: TIER_COLOR[tier],
        marginRight: 8,
        flexShrink: 0,
        marginTop: 6,
      }}
    />
  );
}

export function Stamp({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        display: "inline-block",
        border: `2px solid ${ok ? "var(--feasible)" : "var(--infeasible)"}`,
        color: ok ? "var(--feasible)" : "var(--infeasible)",
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "6px 14px",
        borderRadius: 6,
        transform: "rotate(-2deg)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "10px 13px",
  color: "var(--ink)",
  fontSize: 14,
  boxSizing: "border-box",
};
