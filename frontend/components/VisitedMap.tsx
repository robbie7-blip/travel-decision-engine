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

import { useEffect, useRef, useState } from "react";
import WorldMap, { regions, type CountryContext, type ISOCode } from "react-svg-worldmap";
import { getCountry, getCountryName } from "@/lib/countries";
import type { Language } from "@/lib/types";

interface VisitedMapProps {
  visitedCodes: Set<string>;
  onToggle: (code: string) => void;
  pendingCode: string | null;
  visitedLabel: string;
  notVisitedLabel: string;
  untrackedLabel: string;
  language: Language;
  /** Skips the ResizeObserver-measured sizing below and renders at this
   * exact pixel size instead — for VisitedZoomableMap, whose pan/zoom
   * wrapper sizes ITSELF to its content, which would otherwise deadlock
   * against this component sizing itself to ITS wrapper (both sides
   * waiting on the other, collapsing to ~0px). A fixed intrinsic size also
   * just makes more sense inside a pinch-zoom canvas — you're expected to
   * zoom into it, not have it pre-shrunk to fit the viewport. */
  fixedSize?: number;
}

export function VisitedMap({ visitedCodes, onToggle, pendingCode, visitedLabel, notVisitedLabel, untrackedLabel, language, fixedSize }: VisitedMapProps) {
  // The library's own size="responsive" mode measures its width via a
  // ResizeObserver + window.innerWidth fallback that, on real mobile
  // Safari, was observed rendering the map at a stale/oversized width
  // (roughly desktop-sized) that overflowed this card and bled across the
  // rest of the page uncontrolled — the SVG itself scales its content to
  // fit whatever pixel width it's given, so a wrong width there means a
  // wrong-sized map, not a clipped one. Measuring our own wrapper directly
  // and passing that as an explicit number sidesteps the library's
  // internal sizing entirely — we always tell it exactly how wide it's
  // allowed to be, no guessing on its end.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  useEffect(() => {
    if (fixedSize) return; // no need to observe anything — the size is given, not measured
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setMeasuredWidth(Math.floor(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fixedSize]);

  const mapWidth = fixedSize ?? measuredWidth;

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
    <div
      ref={wrapperRef}
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        boxShadow: "var(--shadow-panel)",
        overflow: "hidden", // belt-and-suspenders: never let map content escape this card, whatever width it ends up computing
      }}
    >
      {/* Nothing to size against yet on the very first paint — rendering at
       * mapWidth=0 would ask the library for a 0px map. Skipping the first
       * frame is invisible (the ResizeObserver callback fires within the
       * same paint cycle) and avoids ever showing a wrongly-sized map. */}
      {mapWidth > 0 && (
      <WorldMap
        data={data}
        size={mapWidth}
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
          // The library's own context.countryName is always English (it's
          // baked into its bundled map data) — for a tracked country, use
          // our own name in the active language instead, so the tooltip
          // doesn't switch back to English mid-Bulgarian-UI. Untracked
          // territories (see file header) aren't in our data at all, so
          // context.countryName is the only name available for those.
          const name = isTracked(code) ? getCountryName(code, language) : context.countryName;
          if (!isTracked(code)) return `${name} — ${untrackedLabel}`;
          return `${name} — ${context.countryValue === 1 ? visitedLabel : notVisitedLabel}`;
        }}
        onClickFunction={(context) => {
          const code = context.countryCode.toUpperCase();
          if (!isTracked(code) || pendingCode) return;
          onToggle(code);
        }}
      />
      )}
    </div>
  );
}
