"use client";

// One of the "Visualize" tabs — Been's "Timeline": every visited country in
// one ordered list, most recent visit first, undated ones at the bottom.
// Distinct from VisitedChronology (year-grouped totals) by staying a flat,
// per-country list — this view is about WHEN each place was, that one is
// about HOW MANY per year.

import { useState } from "react";
import { countryFlagEmoji, getCountry, getCountryName } from "@/lib/countries";
import type { VisitedEntry } from "@/lib/localVisited";
import type { Language } from "@/lib/types";

interface VisitedTimelineProps {
  entries: VisitedEntry[];
  onSetDate: (code: string, visitedAt: string) => void;
  emptyLabel: string;
  dateUnknownLabel: string;
  setDateLabel: string;
  locale: string; // e.g. "en-US"/"bg-BG", passed straight to toLocaleDateString for date formatting
  language: Language; // the app's own Language value, for country name lookup
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

export function VisitedTimeline({ entries, onSetDate, emptyLabel, dateUnknownLabel, setDateLabel, locale, language }: VisitedTimelineProps) {
  const [editingCode, setEditingCode] = useState<string | null>(null);

  const withCountry = entries
    .map((e) => ({ entry: e, country: getCountry(e.code) }))
    .filter((x): x is { entry: VisitedEntry; country: NonNullable<ReturnType<typeof getCountry>> } => x.country !== undefined);

  // Dated entries newest-first, then everything without a date — an
  // unknown date isn't "oldest," it's just not placed on the line yet.
  const dated = withCountry.filter((x) => x.entry.visitedAt).sort((a, b) => (b.entry.visitedAt! < a.entry.visitedAt! ? -1 : 1));
  const undated = withCountry.filter((x) => !x.entry.visitedAt);
  const ordered = [...dated, ...undated];

  if (ordered.length === 0) {
    return <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink-dim)", fontSize: 14 }}>{emptyLabel}</div>;
  }

  return (
    <div>
      {ordered.map(({ entry, country }, i) => (
        <div
          key={entry.code}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 4px",
            borderTop: i === 0 ? undefined : "1px solid var(--line)",
          }}
        >
          <span style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>{countryFlagEmoji(entry.code)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="font-display" style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
              {getCountryName(country.code, language)}
            </div>
            {editingCode === entry.code ? (
              <input
                type="date"
                autoFocus
                defaultValue={entry.visitedAt}
                max={new Date().toISOString().slice(0, 10)}
                onBlur={(e) => {
                  if (e.target.value) onSetDate(entry.code, e.target.value);
                  setEditingCode(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingCode(null);
                }}
                className="font-ui"
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  padding: "4px 8px",
                  border: "1px solid var(--line-strong)",
                  borderRadius: 6,
                  background: "var(--bg-panel-raised)",
                  color: "var(--ink)",
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingCode(entry.code)}
                className="font-ui"
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  color: entry.visitedAt ? "var(--ink-dim)" : "var(--grounded)",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textDecoration: entry.visitedAt ? "none" : "underline",
                }}
              >
                {entry.visitedAt ? formatDate(entry.visitedAt, locale) : `${dateUnknownLabel} — ${setDateLabel}`}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
