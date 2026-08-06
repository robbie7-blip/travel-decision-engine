"use client";

// The actual clickable world map — react-svg-worldmap (MIT), chosen after
// checking it exposes exactly the hooks needed: onClickFunction (toggle a
// country), styleFunction (color by visited state), tooltipTextFunction
// (name + state on hover). Its bundled map covers 173 of the 197 countries
// lib/countries.ts tracks — every UN-member-scale country renders as a real
// clickable shape, but ~24 very small nations (Vatican, Monaco, Singapore,
// Malta, and other city-states/small islands) are too small to exist as a
// distinguishable shape on ANY reasonably-sized world map and simply aren't
// in its data at all. That's a genuine geometric limit of a map view, not a
// bug — VisitedPage keeps the continent-grouped checklist below the map
// specifically so those countries stay reachable. The map's own dataset
// also includes 5 non-sovereign territories (Western Sahara, Falklands,
// Greenland, New Caledonia, Puerto Rico) that aren't in lib/countries.ts at
// all — rendered in a visibly muted, non-interactive style rather than
// silently doing nothing on click.

import WorldMap, { regions, type CountryContext, type ISOCode } from "react-svg-worldmap";
import { getCountry } from "@/lib/countries";

interface VisitedMapProps {
  visitedCodes: Set<string>;
  onToggle: (code: string) => void;
  pendingCode: string | null;
  visitedLabel: string;
  notVisitedLabel: string;
  untrackedLabel: string;
}

export function VisitedMap({ visitedCodes, onToggle, pendingCode, visitedLabel, notVisitedLabel, untrackedLabel }: VisitedMapProps) {
  // Every region the map itself knows how to draw, each flagged 1/0 by
  // whether it's in this traveler's visited set — data doesn't need to
  // (and shouldn't) enumerate lib/countries.ts separately, since the map
  // can only ever click regions it actually renders.
  // regions' own codes are guaranteed valid ISOCode values (they're this
  // same package's data) — the cast is just narrowing `string` back to the
  // literal union its own type declares, not asserting anything unverified.
  const data = regions.map((region) => ({
    country: region.code as ISOCode,
    value: visitedCodes.has(region.code.toUpperCase()) ? 1 : 0,
  }));

  function isTracked(code: string): boolean {
    return getCountry(code) !== undefined;
  }

  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, boxShadow: "var(--shadow-panel)" }}>
      <WorldMap
        data={data}
        size="responsive"
        richInteraction
        borderColor="var(--line-strong)"
        backgroundColor="transparent"
        tooltipBgColor="var(--ink)"
        tooltipTextColor="var(--bg-panel)"
        styleFunction={(context: CountryContext<number>) => {
          const code = context.countryCode.toUpperCase();
          if (!isTracked(code)) {
            // One of the map's own non-sovereign-territory entries that
            // isn't in our tracked list at all (see file header) — muted
            // and visibly non-interactive rather than a normal map color.
            return { fill: "var(--bg-panel-raised)", stroke: "var(--line)", strokeWidth: 0.5, cursor: "default" };
          }
          const visited = context.countryValue === 1;
          // --bg-panel-raised (used for the untracked/muted case above) is
          // only a shade off the card's own white background — fine for
          // "blend in, ignore this," but it made every real, clickable
          // country invisible too when first tried. --line-strong (a warm
          // tan) is the map's actual "land" color: clearly visible against
          // the white card without being confused with --accent-green's
          // "visited" state.
          return {
            fill: visited ? "var(--accent-green)" : "var(--line-strong)",
            stroke: "var(--ink-dim)",
            strokeWidth: 0.5,
            cursor: pendingCode === code ? "default" : "pointer",
            opacity: pendingCode === code ? 0.6 : 1,
            transition: "fill 0.15s ease",
          };
        }}
        tooltipTextFunction={(context: CountryContext<number>) => {
          const code = context.countryCode.toUpperCase();
          if (!isTracked(code)) return `${context.countryName} — ${untrackedLabel}`;
          return `${context.countryName} — ${context.countryValue === 1 ? visitedLabel : notVisitedLabel}`;
        }}
        onClickFunction={(context) => {
          const code = context.countryCode.toUpperCase();
          if (!isTracked(code) || pendingCode) return;
          onToggle(code);
        }}
      />
    </div>
  );
}
