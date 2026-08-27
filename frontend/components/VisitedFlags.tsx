"use client";

// One of the "Visualize" tabs (see app/account/visited/page.tsx) — a plain
// grid of flags for every visited country, Been's "Flags" view. The
// cheapest of the new views to build correctly: no new data, no new
// dependency, countryFlagEmoji() already exists for the checklist below the
// map. Clicking a flag un-marks that country, same as everywhere else in
// the tracker — there's no reason this view should be read-only when the
// map and checklist aren't.

import { countryFlagEmoji, getCountry, getCountryName } from "@/lib/countries";
import type { Language } from "@/lib/types";

interface VisitedFlagsProps {
  codes: string[];
  onToggle: (code: string) => void;
  emptyLabel: string;
  language: Language;
}

export function VisitedFlags({ codes, onToggle, emptyLabel, language }: VisitedFlagsProps) {
  const countries = codes
    .map((code) => getCountry(code))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => ({ ...c, displayName: getCountryName(c.code, language) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, language));

  if (countries.length === 0) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink-dim)", fontSize: 14 }}>{emptyLabel}</div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
        gap: 10,
      }}
    >
      {countries.map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => onToggle(c.code)}
          className="hover-card"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "14px 8px",
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "var(--bg-panel)",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 34, lineHeight: 1 }}>{countryFlagEmoji(c.code)}</span>
          <span className="font-ui" style={{ fontSize: 11, color: "var(--ink-soft)", textAlign: "center" }}>
            {c.displayName}
          </span>
        </button>
      ))}
    </div>
  );
}
