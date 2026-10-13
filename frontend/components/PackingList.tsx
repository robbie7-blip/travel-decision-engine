"use client";

// What to pack, with the fact behind each line.
//
// The list itself is computed in lib/packing.ts from this trip's own
// forecast and its structured fields - no model call, so it costs nothing,
// cannot hallucinate, appears instantly and still works on the plane,
// where the trip page already does. This file is only the rendering, and
// the one thing it insists on is that every line SAYS WHY it is there.
// That is not decoration: it is the same posture as every other line on
// this page, where a confidence tag names where the claim came from. "An
// umbrella - rain forecast on 3 of your days" is a different object from
// "umbrella".

import type { Dictionary } from "@/lib/i18n";
import { packingListFor } from "@/lib/packing";
import type { DestinationWeather } from "@/lib/weather";
import type { ItineraryDay } from "@/lib/types";
import { SectionLabel } from "./ui";

export function PackingList({
  weather,
  days,
  startDate,
  endDate,
  t,
}: {
  /** Shared with WeatherStrip rather than fetched again - see
   * lib/useWeather.ts. null while it is still in flight. */
  weather: DestinationWeather | null;
  days?: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  t: Dictionary;
}) {
  // Nothing at all until the forecast has landed. The three unconditional
  // lines would render without it, but a panel headed "What to pack" that
  // says only "a plug adapter" and then silently grows a winter coat a
  // second later is worse than one that waits.
  if (!weather) return null;

  const list = packingListFor({ weather, days, startDate, endDate });
  if (!list.hasWeather) return null;

  const copy = t.result.packing;
  const range =
    list.coldestC !== null && list.hottestC !== null
      ? copy.basedOn.replace("{cold}", `${list.coldestC}C`).replace("{hot}", `${list.hottestC}C`)
      : "";

  /** The reason, as a sentence in the reading language. The reason is held
   * as data precisely so this can happen here (see PackingReason). */
  function because(entry: (typeof list.entries)[number]): string {
    const template = copy.reasons[entry.reason.kind] ?? "";
    const value = "value" in entry.reason ? entry.reason.value : undefined;
    return value === undefined ? template : template.replace("{value}", String(value));
  }

  return (
    <div className="packing" style={{ marginTop: 28 }}>
      <SectionLabel>{copy.heading}</SectionLabel>
      {range && <p className="packing-basis font-ui">{range}</p>}
      {/* The same caveat the forecast strip carries, for the same reason:
          beyond the forecast horizon these are historical averages, and a
          packing list built on them should say so rather than imply a
          forecast exists. */}
      {list.someHistorical && <p className="packing-basis font-ui">{t.result.weather.historicalNote}</p>}
      <ul className="packing-list">
        {list.entries.map((entry) => (
          <li key={entry.id} className="packing-item">
            <span className="packing-what">{copy.items[entry.id] ?? entry.id}</span>
            <span className="packing-why font-ui">{because(entry)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
