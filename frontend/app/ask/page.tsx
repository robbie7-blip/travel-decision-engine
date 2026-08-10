"use client";

import { useEffect, useState } from "react";
import { TripQA } from "@/components/TripQA";
import { SiteHeader } from "@/components/SiteHeader";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** Standalone entry point for the trip-Q&A feature — no generated
 * itinerary needed. For a traveler who already planned everything
 * elsewhere (or hasn't started) and just has a practical question:
 * packing, safety, local customs. The same <TripQA> also appears embedded
 * on a generated itinerary's result page (see ItineraryResult.tsx), where
 * it gets real trip context automatically instead of relying on whatever
 * the traveler happens to mention here. */
export default function AskPage() {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);
  }, []);

  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Header intentionally wider (1450) than this page's own 720px
          content column below — see globals.css .nav-link comment history:
          720 was too narrow to fit the full nav without wrapping, which is
          what made this page's header look different from wider pages
          (destinations, showcase, trip). 1450 matches the header width used
          site-wide now, independent of how narrow any given page's own
          reading column is. */}
      <SiteHeader
        language={language}
        onLanguageChange={setLanguage}
        t={t}
        maxWidth={1450}
        contextLink={{ href: "/", label: `${t.trip.planAnother} →` }}
      />

      <div style={{ padding: "36px 0 64px" }}>
        {/* Outer 1450 matches the header above so this page's content
            starts at the same left edge as every other page's — see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px", color: "var(--brand-teal)" }}>
            {t.tripQA.pageHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 24px", lineHeight: 1.5 }}>
            {t.tripQA.pageSubheading}
          </p>
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 20,
              boxShadow: "var(--shadow-panel)",
            }}
          >
            <TripQA language={language} t={t} />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
