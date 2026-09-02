import type { CSSProperties, ReactNode } from "react";
import type { ConfidenceTier } from "@/lib/types";

const TIER_COLOR: Record<ConfidenceTier, string> = {
  verified: "var(--grounded)",
  fact_grounded: "var(--grounded)",
  single_source: "var(--tier-single-source)",
  conflicting: "var(--unverified)",
  inferred: "var(--tier-inferred)",
};

/** The confidence marker on every itinerary line.
 *
 * Was a 9px coloured circle. Two problems with that, and replacing it fixes
 * both at once.
 *
 * It failed WCAG 1.4.1. inlineTierLabel only ever carried a string for
 * single_source, so for the other four tiers the colour of that dot was the
 * ONLY thing distinguishing them — on the feature this product is built
 * around. A colourblind traveler could not read the trust system at all,
 * and everyone else had to learn a five-colour legend before the page meant
 * anything.
 *
 * And a row of small coloured dots down the left margin is, visually, the
 * house style of the thing reviewers kept saying this looked like. A word
 * in a ruled tag is what a printed guide would do, reads without a legend,
 * and is not a circle. */
export function ConfidenceTag({ tier, label }: { tier: ConfidenceTier; label: string }) {
  return (
    <span
      className="font-ui"
      style={{
        display: "inline-block",
        flexShrink: 0,
        borderLeft: `3px solid ${TIER_COLOR[tier]}`,
        paddingLeft: 6,
        fontSize: 9.5,
        lineHeight: 1.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** The same marker with no text, for the legend rows where the full label
 * already sits beside it — a rule rather than a dot, so the legend and the
 * itinerary use the same vocabulary. */
export function ConfidenceRule({ tier }: { tier: ConfidenceTier }) {
  return (
    <span
      aria-hidden="true"
      data-tier-rule={tier}
      style={{
        display: "inline-block",
        width: 3,
        alignSelf: "stretch",
        minHeight: 14,
        background: TIER_COLOR[tier],
        marginRight: 8,
        flexShrink: 0,
      }}
    />
  );
}

export function Stamp({ ok, color, children }: { ok: boolean; color?: string; children: ReactNode }) {
  const resolved = color ?? (ok ? "var(--feasible)" : "var(--infeasible)");
  return (
    <div
      className="font-ui"
      style={{
        display: "inline-block",
        background: resolved,
        border: `2px solid ${resolved}`,
        color: "white",
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "6px 14px",
        borderRadius: 6,
        transform: "rotate(-2deg)",
        fontSize: 13,
        // resolved is a var(--x) reference (or occasionally a literal from
        // trustScoreColor), never a bare hex — color-mix lets the shadow
        // pick up its alpha without string-concatenating onto a var().
        boxShadow: `0 4px 14px -2px color-mix(in srgb, ${resolved} 45%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 20 }}>
      {/* Was 11px uppercase in --ink-dim with 0.08em tracking: a caption,
          floating over a field that had no edges of its own. On the one
          surface that has to be obviously fillable, the label should read
          as a question being asked, so it is sentence-size, sentence-case
          and in the darker ink. */}
      <div
        className="font-ui"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink-soft)",
          marginBottom: 7,
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
      className="font-ui"
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

/** Heading + body block shared by /terms, /privacy, and /cookies — the
 * three legal pages were each hand-rolling an identical version of this
 * before, which is exactly the kind of drift risk worth collapsing into
 * one place (unlike the header markup those same pages duplicate, which
 * differs in small page-specific ways — see why-decide/page.tsx etc.). */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 className="font-display" style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>
        {heading}
      </h2>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>{children}</div>
    </div>
  );
}

/** The shared field look, for the controls that build their own trigger
 * rather than being a plain <input> inside .trip-form-grid — the two date
 * pickers. Kept in step with the CSS by hand, which is the price of those
 * controls not being inputs.
 *
 * Matches the rest of the form: white fill, a border you can see, and a
 * 48px target. It used to be a recessed beige box with an inset shadow,
 * which made the one field a traveler cannot skip the only field that
 * looked like it belonged to a different form. */
export const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: 48,
  background: "var(--bg-panel)",
  border: "1px solid var(--line-strong)",
  borderRadius: 6,
  padding: "12px 14px",
  color: "var(--ink)",
  fontSize: 15,
  boxSizing: "border-box",
};