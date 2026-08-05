"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Continent } from "@/lib/countries";
import type { Language } from "@/lib/types";

interface VisitedStats {
  countriesVisited: number;
  totalCountries: number;
  percentOfWorld: number;
  continentsVisited: Continent[];
  continentsTotal: number;
  earnedBadgeIds: string[];
}

type Fetched = { status: "loading" } | { status: "ok"; stats: VisitedStats } | { status: "error" };

function useStatsFor(token: string | null): Fetched {
  const [result, setResult] = useState<Fetched>({ status: "loading" });

  useEffect(() => {
    if (!token) return;
    setResult({ status: "loading" });
    fetch(`/api/stats-share/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          setResult({ status: "error" });
          return;
        }
        const data = await r.json();
        setResult({ status: "ok", stats: data.stats });
      })
      .catch(() => setResult({ status: "error" }));
  }, [token]);

  return result;
}

/** One person's stats card — shared markup between the "yours" and
 * "theirs" columns below, and deliberately similar to the card on
 * /account/visited so the same numbers read consistently in both places. */
function StatsCard({
  label,
  fetched,
  t,
}: {
  label: string;
  fetched: Fetched;
  t: (typeof TRANSLATIONS)["en"];
}) {
  return (
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 20,
        boxShadow: "var(--shadow-panel)",
      }}
    >
      <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 12 }}>
        {label}
      </div>
      {fetched.status === "loading" && (
        <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-dim)" }}>
          ...
        </div>
      )}
      {fetched.status === "error" && (
        <div className="font-mono" style={{ fontSize: 13, color: "var(--infeasible)" }}>
          {t.compareStats.invalidLink}
        </div>
      )}
      {fetched.status === "ok" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: fetched.stats.earnedBadgeIds.length > 0 ? 14 : 0 }}>
            <div>
              <div className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                {fetched.stats.countriesVisited}
              </div>
              <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                {t.visited.statsCountries.replace("{count}", String(fetched.stats.countriesVisited))}
              </div>
            </div>
            <div>
              <div className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                {fetched.stats.percentOfWorld}%
              </div>
              <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                {t.visited.statsPercent.replace("{percent}", String(fetched.stats.percentOfWorld))}
              </div>
            </div>
            <div>
              <div className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>
                {fetched.stats.continentsVisited.length}/{fetched.stats.continentsTotal}
              </div>
              <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                {t.visited.statsContinents
                  .replace("{count}", String(fetched.stats.continentsVisited.length))
                  .replace("{total}", String(fetched.stats.continentsTotal))}
              </div>
            </div>
          </div>
          {fetched.stats.earnedBadgeIds.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {fetched.stats.earnedBadgeIds.map((id) => (
                <span
                  key={id}
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    border: "1px solid var(--accent-green)",
                    color: "var(--accent-green)",
                    borderRadius: 999,
                    padding: "3px 10px",
                  }}
                >
                  🏅 {t.visited.badges[id as keyof typeof t.visited.badges] ?? id}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A stats-comparison view built from two share tokens (?a=/?b=) — same
 * lightweight, no-friend-graph share-link pattern as the itinerary
 * comparison at /compare (?a=/?b= job IDs there). Anyone with both links
 * can view them side by side; there's no request/accept step. */
export function CompareStatsView() {
  const [language, setLanguageState] = useState<Language>("en");
  const searchParams = useSearchParams();
  const tokenA = searchParams.get("a");
  const tokenB = searchParams.get("b");

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);
  }, []);

  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  const statsA = useStatsFor(tokenA);
  const statsB = useStatsFor(tokenB);

  const header = (
    <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
          <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--grounded)" }}>
            decide
          </span>
        </a>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginLeft: "auto" }}>
          <a href="/account/visited" className="font-mono" style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}>
            {t.compareStats.getYourLink}
          </a>
          <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
          <div className="font-mono" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
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
  );

  if (!tokenA) {
    return (
      <div style={{ minHeight: "100%" }}>
        {header}
        <div style={{ padding: "36px 24px" }}>
          <div className="font-mono" style={{ maxWidth: 860, margin: "0 auto", fontSize: 14, color: "var(--infeasible)" }}>
            {t.compareStats.missingLink}{" "}
            <a href="/account/visited" style={{ color: "var(--infeasible)" }}>
              {t.compareStats.getYourLink}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%" }}>
      {header}
      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 24px", color: "var(--ink)" }}>
            {t.compareStats.heading}
          </h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <StatsCard label={t.compareStats.yourStats} fetched={statsA} t={t} />
            {tokenB && <StatsCard label={t.compareStats.friendStats} fetched={statsB} t={t} />}
          </div>
        </div>
      </div>
    </div>
  );
}
