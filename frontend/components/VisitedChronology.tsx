"use client";

// One of the "Visualize" tabs - Been's "Chronology": travel history grouped
// by year instead of VisitedTimeline's flat per-country list. Answers "how
// much did I travel in a given year" rather than "when was I in country X."
// Countries with no recorded date land in their own "Undated" group at the
// top - they don't have a place on the chronological line yet, so grouping
// them under a fabricated year would be more misleading than useful.

import { countryFlagEmoji, getCountry, getCountryName } from "@/lib/countries";
import type { VisitedEntry } from "@/lib/localVisited";
import type { Language } from "@/lib/types";

interface VisitedChronologyProps {
  entries: VisitedEntry[];
  undatedLabel: string;
  countLabel: string; // "{count} countries", "{count}" placeholder
  language: Language;
}

export function VisitedChronology({ entries, undatedLabel, countLabel, language }: VisitedChronologyProps) {
  const withCountry = entries
    .map((e) => ({ entry: e, country: getCountry(e.code) }))
    .filter((x): x is { entry: VisitedEntry; country: NonNullable<ReturnType<typeof getCountry>> } => x.country !== undefined);

  const byYear = new Map<string, typeof withCountry>();
  for (const item of withCountry) {
    const year = item.entry.visitedAt ? item.entry.visitedAt.slice(0, 4) : "undated";
    const bucket = byYear.get(year) ?? [];
    bucket.push(item);
    byYear.set(year, bucket);
  }

  const years = [...byYear.keys()].filter((y) => y !== "undated").sort(); // oldest first - this IS the chronology
  const orderedKeys = byYear.has("undated") ? ["undated", ...years] : years;
  const maxCount = Math.max(...orderedKeys.map((y) => byYear.get(y)!.length), 1);

  if (orderedKeys.length === 0) return null;

  return (
    <div>
      {orderedKeys.map((year, i) => {
        const items = byYear.get(year)!;
        return (
          <div key={year} style={{ padding: "14px 4px", borderTop: i === 0 ? undefined : "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
              <div className="font-display" style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>
                {year === "undated" ? undatedLabel : year}
              </div>
              <div className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {countLabel.replace("{count}", String(items.length))}
              </div>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: "var(--bg-panel-raised)",
                overflow: "hidden",
                marginBottom: 10,
                maxWidth: 320,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(items.length / maxCount) * 100}%`,
                  background: year === "undated" ? "var(--ink-dim)" : "var(--accent-green)",
                  borderRadius: 999,
                }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {items.map(({ entry, country }) => (
                <span
                  key={entry.code}
                  title={getCountryName(country.code, language)}
                  style={{ fontSize: 22, lineHeight: 1, cursor: "default" }}
                >
                  {countryFlagEmoji(entry.code)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
