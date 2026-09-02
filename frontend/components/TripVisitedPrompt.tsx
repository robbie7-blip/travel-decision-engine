"use client";

// At the end of a finished itinerary: "been here now?" - add the trip's
// countries to Places you've been, and keep a photo or two with them.
//
// This is the moment the tracker was missing. Marking a country visited
// previously meant remembering the feature exists, navigating to it, and
// finding the country on a map; the one moment someone is certain to be
// thinking about a specific trip is when they are looking at it. So the
// prompt comes to them, already knowing which countries it means.
//
// The country comes from /api/place-country, a free Open-Meteo geocode of
// the destination names. Nothing renders until that resolves, and nothing
// renders if it fails: a prompt that offers to add the wrong country is
// worse than no prompt.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCountryName, countryFlagEmoji } from "@/lib/countries";
import { readLocalVisitedEntries, writeLocalVisitedEntries } from "@/lib/localVisited";
import { deletePhotosForPlace, placeKeyFor } from "@/lib/visitedPhotos";
import { VisitedPhotos } from "./VisitedPhotos";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function TripVisitedPrompt({
  destinations,
  endDate,
  t,
  language,
}: {
  /** Optional because the caller reads it off a brief that may not carry
   * one; with no destinations there is nothing to geocode and the prompt
   * renders nothing. */
  destinations: string[] | undefined;
  /** The trip's last day. A trip that hasn't happened yet isn't somewhere
   * you've been, so the prompt stays away until it's over. */
  endDate?: string;
  t: Dictionary;
  language: Language;
}) {
  const [countries, setCountries] = useState<string[] | null>(null);
  const [added, setAdded] = useState(false);
  const alreadyHad = useRef<Set<string>>(new Set());

  const tripIsOver = (() => {
    if (!endDate) return true;
    const end = new Date(`${endDate}T23:59:59`);
    return !Number.isNaN(end.getTime()) && end.getTime() <= Date.now();
  })();

  useEffect(() => {
    if (!tripIsOver || !destinations || destinations.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/place-country?cities=${encodeURIComponent(destinations.join(","))}`);
        if (!res.ok) return;
        const data = (await res.json()) as { countries?: string[] };
        if (cancelled || !Array.isArray(data.countries) || data.countries.length === 0) return;

        // Countries already on the map are remembered, so Undo puts things
        // back exactly as they were rather than deleting a visit that
        // predates this trip.
        const existing = new Set(readLocalVisitedEntries().map((e) => e.code));
        alreadyHad.current = new Set(data.countries.filter((c) => existing.has(c)));
        setCountries(data.countries);
        // Every country here is already marked, so there is nothing to
        // offer - but the photo half is still worth showing.
        if (data.countries.every((c) => existing.has(c))) setAdded(true);
      } catch {
        // Offline, or the geocoder is down. No prompt.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destinations, tripIsOver]);

  if (!countries || countries.length === 0) return null;

  const names = countries.map((c) => getCountryName(c, language)).join(", ");

  function add() {
    const entries = readLocalVisitedEntries();
    const byCode = new Map(entries.map((e) => [e.code, e]));
    for (const code of countries ?? []) {
      if (!byCode.has(code)) byCode.set(code, { code, ...(endDate ? { visitedAt: endDate } : {}) });
    }
    writeLocalVisitedEntries([...byCode.values()]);
    setAdded(true);
  }

  function undo() {
    const keep = readLocalVisitedEntries().filter(
      (e) => !(countries ?? []).includes(e.code) || alreadyHad.current.has(e.code)
    );
    writeLocalVisitedEntries(keep);
    // Photos for a country this prompt added, and that is now being
    // removed again, go with it - otherwise they sit in the database with
    // no country on the map to reach them through.
    for (const code of countries ?? []) {
      if (!alreadyHad.current.has(code)) void deletePhotosForPlace(placeKeyFor(code));
    }
    setAdded(false);
  }

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--bg-panel)",
        padding: 20,
        marginTop: 32,
      }}
    >
      <div className="font-display" style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
        {t.visited.tripPrompt.heading}
      </div>
      <div className="font-ui" style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 14 }}>
        {added
          ? t.visited.tripPrompt.added.replace("{places}", names)
          : t.visited.tripPrompt.body.replace("{places}", names)}
      </div>

      {!added ? (
        <button type="button" onClick={add} className="font-ui btn-primary" style={{ padding: "10px 18px", fontSize: 13 }}>
          <span aria-hidden style={{ marginRight: 8 }}>
            {countries.map((c) => countryFlagEmoji(c)).join(" ")}
          </span>
          {t.visited.tripPrompt.addButton}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {countries.map((code) => (
            <div key={code}>
              <div className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 8 }}>
                <span aria-hidden style={{ marginRight: 6 }}>
                  {countryFlagEmoji(code)}
                </span>
                {getCountryName(code, language)}
              </div>
              <VisitedPhotos placeKey={placeKeyFor(code)} t={t} compact />
            </div>
          ))}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Link href="/account/visited" className="font-ui" style={{ fontSize: 12, color: "var(--brand-teal)" }}>
              {t.visited.navLink}
            </Link>
            <button
              type="button"
              onClick={undo}
              className="font-ui"
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 12,
                color: "var(--ink-dim)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              {t.visited.tripPrompt.undo}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
