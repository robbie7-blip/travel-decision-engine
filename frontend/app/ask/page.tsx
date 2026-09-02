"use client";

import { useEffect, useState } from "react";
import { TripQA } from "@/components/TripQA";
import { SiteHeader } from "@/components/SiteHeader";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

// Same tinted-circle icon badge used on the homepage's "How it works" and
// the pricing page's value props — reused here (topics[0..2]) so /ask
// carries the site's visual identity instead of reading as bare text next
// to a form, which is what it used to be.
const TOPIC_ICONS = [
  {
    tint: "rgba(31, 111, 138, 0.1)",
    stroke: "var(--color-blue)",
    path: (
      <g transform="translate(19, 20)">
        <rect x="6" y="8" width="30" height="22" rx="3" fill="none" stroke="var(--color-blue)" strokeWidth="2.2" />
        <path d="M15 8 v-3 a3 3 0 0 1 3 -3 h6 a3 3 0 0 1 3 3 v3" fill="none" stroke="var(--color-blue)" strokeWidth="2.2" />
        <line x1="6" y1="17" x2="36" y2="17" stroke="var(--color-blue)" strokeWidth="1.6" opacity="0.6" />
      </g>
    ),
  },
  {
    tint: "rgba(125, 91, 166, 0.1)",
    stroke: "var(--color-purple)",
    path: (
      <g transform="translate(21, 17)">
        <path d="M19 3 L34 9 v11 c0 10 -7.5 16 -15 19 c-7.5 -3 -15 -9 -15 -19 V9 Z" fill="rgba(125,91,166,0.15)" stroke="var(--color-purple)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M11 20 l6 6 l12 -13" fill="none" stroke="var(--color-purple)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
  },
  {
    tint: "rgba(63, 122, 74, 0.1)",
    stroke: "var(--accent-green)",
    path: (
      <g transform="translate(18, 22)">
        <circle cx="22" cy="10" r="9" fill="none" stroke="var(--accent-green)" strokeWidth="2.2" />
        <path d="M13 10 h18 M22 1 a13 13 0 0 1 0 18 M22 1 a13 13 0 0 0 0 18" fill="none" stroke="var(--accent-green)" strokeWidth="1.6" opacity="0.7" />
        <path d="M2 30 c0 -6 4 -10 8 -10 s8 4 8 10" fill="none" stroke="var(--accent-green)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="10" cy="12" r="5" fill="none" stroke="var(--accent-green)" strokeWidth="2.2" />
      </g>
    ),
  },
];

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

      <div style={{ padding: "36px clamp(32px, 8%, 180px) 64px" }}>
        {/* Outer 1450 matches the header above so this page's content
            starts at the same left edge as every other page's — see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1100 }}>
          <h1 className="font-display" style={{ fontSize: "clamp(28px, 4.5vw, 38px)", fontWeight: 600, lineHeight: 1.2, margin: "0 0 8px", color: "var(--ink)" }}>
            {t.tripQA.pageHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 32px", lineHeight: 1.5, maxWidth: 640 }}>
            {t.tripQA.pageSubheading}
          </p>

          {/* Scope preview — what kind of question this is for, shown
              before the input so a first-time visitor isn't staring at an
              empty box wondering what's in bounds. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginBottom: 36 }}>
            {TOPIC_ICONS.map((icon, i) => (
              <div key={i}>
                <svg viewBox="0 0 80 80" style={{ width: 44, height: 44, marginBottom: 10 }}>
                  <circle cx="40" cy="40" r="35" fill={icon.tint} stroke={icon.stroke} strokeWidth="2" />
                  {icon.path}
                </svg>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}>
                  {t.tripQA.topics[i].title}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 }}>{t.tripQA.topics[i].body}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: 24,
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
