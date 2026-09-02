"use client";

// The Photos tab on the visited page: one row per country you've marked
// visited, each with its own photos and an add button.
//
// Sits alongside Map / Globe / Flags / Timeline as another way of looking
// at the same list, rather than as a separate feature - the countries here
// are exactly the ones already on the map, and there is nothing to add a
// photo to until a country is marked.

import { getCountry, getCountryName, countryFlagEmoji } from "@/lib/countries";
import { placeKeyFor } from "@/lib/visitedPhotos";
import { VisitedPhotos } from "./VisitedPhotos";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function VisitedPhotoWall({
  codes,
  t,
  language,
}: {
  codes: string[];
  t: Dictionary;
  language: Language;
}) {
  const known = codes.filter((code) => getCountry(code) !== undefined);

  if (known.length === 0) {
    return (
      <div className="font-ui" style={{ fontSize: 13, color: "var(--ink-dim)" }}>
        {t.visited.visualize.photosEmpty}
      </div>
    );
  }

  return (
    <div>
      <p className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.5, margin: "0 0 20px", maxWidth: 620 }}>
        {t.visited.visualize.photosIntro}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {known
          .slice()
          .sort((a, b) => getCountryName(a, language).localeCompare(getCountryName(b, language)))
          .map((code) => (
            <div key={code} style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <div
                className="font-ui"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 10 }}
              >
                <span aria-hidden style={{ marginRight: 8 }}>
                  {countryFlagEmoji(code)}
                </span>
                {getCountryName(code, language)}
              </div>
              <VisitedPhotos placeKey={placeKeyFor(code)} t={t} />
            </div>
          ))}
      </div>
    </div>
  );
}
