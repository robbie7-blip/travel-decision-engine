"use client";

import { useEffect, useState } from "react";
import { LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { COUNTRIES, countryFlagEmoji, CONTINENTS, type Continent } from "@/lib/countries";
import type { Language } from "@/lib/types";

interface VisitedStats {
  countriesVisited: number;
  totalCountries: number;
  percentOfWorld: number;
  continentsVisited: Continent[];
  continentsTotal: number;
  earnedBadgeIds: string[];
}

/** The Been-style visited-countries tracker. Requires a signed-in account
 * (see /api/visited) — there's no anonymous/local-only mode, since a
 * visited list is exactly the kind of thing someone expects to follow them
 * across devices. */
export default function VisitedPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<VisitedStats | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);

    fetch("/api/visited")
      .then(async (r) => {
        // Any non-2xx (401 not signed in, 500 misconfigured, etc.) falls
        // back to the same "not signed in" state — there's no separate UI
        // for "signed in but something went wrong," and defaulting to the
        // sign-in prompt is safer than silently rendering nothing.
        if (!r.ok) {
          setSignedIn(false);
          return;
        }
        const data = await r.json();
        setSignedIn(true);
        setCodes(new Set<string>(data.codes ?? []));
        setStats(data.stats ?? null);
      })
      .catch(() => setSignedIn(false));
  }, []);

  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function toggle(code: string) {
    if (pending) return;
    const nextVisited = !codes.has(code);
    setPending(code);
    // Optimistic update — reverted below if the request fails.
    setCodes((prev) => {
      const next = new Set(prev);
      if (nextVisited) next.add(code);
      else next.delete(code);
      return next;
    });
    try {
      const res = await fetch("/api/visited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, visited: nextVisited }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCodes(new Set<string>(data.codes ?? []));
      setStats(data.stats ?? null);
    } catch {
      // Revert the optimistic toggle on failure.
      setCodes((prev) => {
        const next = new Set(prev);
        if (nextVisited) next.delete(code);
        else next.add(code);
        return next;
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
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
            <a href="/account" className="font-mono" style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}>
              {t.visited.backToAccount}
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

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>
            {t.visited.pageHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 24px", lineHeight: 1.5 }}>
            {t.visited.pageSubheading}
          </p>

          {signedIn === false && (
            <div
              className="font-mono"
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 20,
                boxShadow: "var(--shadow-panel)",
                fontSize: 13,
                color: "var(--ink-dim)",
              }}
            >
              {t.visited.signInPrompt}
            </div>
          )}

          {signedIn && stats && (
            <>
              <div
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 20,
                  boxShadow: "var(--shadow-panel)",
                  marginBottom: 28,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: stats.earnedBadgeIds.length > 0 ? 16 : 0 }}>
                  <div>
                    <div className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
                      {stats.countriesVisited}
                    </div>
                    <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {t.visited.statsCountries.replace("{count}", String(stats.countriesVisited))}
                    </div>
                  </div>
                  <div>
                    <div className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
                      {stats.percentOfWorld}%
                    </div>
                    <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {t.visited.statsPercent.replace("{percent}", String(stats.percentOfWorld))}
                    </div>
                  </div>
                  <div>
                    <div className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
                      {stats.continentsVisited.length}/{stats.continentsTotal}
                    </div>
                    <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {t.visited.statsContinents
                        .replace("{count}", String(stats.continentsVisited.length))
                        .replace("{total}", String(stats.continentsTotal))}
                    </div>
                  </div>
                </div>
                {stats.earnedBadgeIds.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {stats.earnedBadgeIds.map((id) => (
                      <span
                        key={id}
                        className="font-mono"
                        style={{
                          fontSize: 11,
                          border: "1px solid var(--accent-green)",
                          color: "var(--accent-green)",
                          borderRadius: 999,
                          padding: "4px 12px",
                        }}
                      >
                        🏅 {t.visited.badges[id as keyof typeof t.visited.badges] ?? id}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {CONTINENTS.map((continent) => (
                <div key={continent} style={{ marginBottom: 28 }}>
                  <div
                    className="font-mono"
                    style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 10 }}
                  >
                    {continent}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {COUNTRIES.filter((c) => c.continent === continent).map((c) => {
                      const isVisited = codes.has(c.code);
                      return (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => toggle(c.code)}
                          disabled={pending === c.code}
                          className="font-mono"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            border: `1px solid ${isVisited ? "var(--accent-green)" : "var(--line)"}`,
                            background: isVisited ? "var(--accent-green)" : "var(--bg-panel)",
                            color: isVisited ? "var(--bg-panel)" : "var(--ink-soft)",
                            borderRadius: 999,
                            padding: "6px 12px",
                            fontSize: 12,
                            cursor: pending === c.code ? "default" : "pointer",
                            opacity: pending === c.code ? 0.6 : 1,
                          }}
                        >
                          <span>{countryFlagEmoji(c.code)}</span>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
