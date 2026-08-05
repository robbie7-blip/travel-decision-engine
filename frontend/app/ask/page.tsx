"use client";

import { useEffect, useState } from "react";
import { TripQA } from "@/components/TripQA";
import { LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
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
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
          }}
        >
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
            <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--grounded)" }}>
              decide
            </span>
          </a>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginLeft: "auto" }}>
            <a
              href="/"
              className="font-mono"
              style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}
            >
              {t.trip.planAnother} →
            </a>
            <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
            <div
              className="font-mono"
              style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
            >
              {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  style={{
                    border: "none",
                    padding: "6px 12px",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    background: language === lang ? "var(--accent-green)" : "transparent",
                    color: language === lang ? "var(--bg-panel)" : "var(--ink-dim)",
                  }}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>
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
  );
}
