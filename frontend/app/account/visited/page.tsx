"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { VisitedMap } from "@/components/VisitedMap";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The Been-style visited-countries tracker. Requires a signed-in account
 * (see /api/visited) — there's no anonymous/local-only mode, since a
 * visited list is exactly the kind of thing someone expects to follow them
 * across devices. Handles sign-in inline (rather than sending someone away
 * to /account and back) — this page IS the primary entry point for the
 * feature, not something reached only after already being signed in for
 * some other reason. */
export default function VisitedPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<VisitedStats | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const [signInEmail, setSignInEmail] = useState("");
  const [signInSending, setSignInSending] = useState(false);
  const [signInMessage, setSignInMessage] = useState("");
  const [signInError, setSignInError] = useState("");

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [friendLink, setFriendLink] = useState("");

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

  async function requestSignIn() {
    const trimmed = signInEmail.trim();
    if (!EMAIL_RE.test(trimmed)) return;
    setSignInSending(true);
    setSignInError("");
    setSignInMessage("");
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : t.account.genericError);
      }
      setSignInMessage(t.visited.signInSent);
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setSignInSending(false);
    }
  }

  async function getShareLink() {
    setShareLoading(true);
    try {
      const res = await fetch("/api/visited/share");
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.url === "string") {
        setShareUrl(data.url);
      }
    } finally {
      setShareLoading(false);
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // link is still visible and selectable, so this just skips the
      // "Copied!" confirmation rather than erroring.
    }
  }

  // Accepts either a full compare-stats URL or a bare token — whichever
  // someone happens to paste in.
  function extractToken(input: string): string {
    const trimmed = input.trim();
    try {
      const url = new URL(trimmed);
      return url.searchParams.get("a") ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  function compareWithFriend() {
    const friendToken = extractToken(friendLink);
    if (!friendToken || !shareUrl) return;
    const myToken = extractToken(shareUrl);
    window.location.href = `/compare-stats?a=${myToken}&b=${friendToken}`;
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <SiteHeader
        language={language}
        onLanguageChange={setLanguage}
        t={t}
        contextLink={{ href: "/account", label: t.visited.backToAccount }}
      />

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
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 20,
                boxShadow: "var(--shadow-panel)",
              }}
            >
              <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 12 }}>
                {t.visited.signInPrompt}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="email"
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  placeholder={t.account.emailPlaceholder}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: "var(--bg-panel-raised)",
                    border: "1px solid var(--line-strong)",
                    borderRadius: 8,
                    padding: "10px 13px",
                    color: "var(--ink)",
                    fontSize: 14,
                    boxSizing: "border-box",
                    boxShadow: "inset 0 1px 3px rgba(43, 36, 28, 0.08)",
                  }}
                />
                <button
                  onClick={requestSignIn}
                  disabled={signInSending || !signInEmail.trim()}
                  className="font-mono btn-primary"
                  style={{
                    padding: "10px 16px",
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    cursor: signInSending || !signInEmail.trim() ? "default" : "pointer",
                    flexShrink: 0,
                  }}
                >
                  {t.visited.signInButton}
                </button>
              </div>
              {signInMessage && (
                <div className="font-mono" style={{ fontSize: 12, color: "var(--accent-green)", marginTop: 10 }}>
                  {signInMessage}
                </div>
              )}
              {signInError && (
                <div className="font-mono" style={{ fontSize: 12, color: "var(--infeasible)", marginTop: 10 }}>
                  {signInError}
                </div>
              )}
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

              <div style={{ marginBottom: 28 }}>
                <VisitedMap
                  visitedCodes={codes}
                  onToggle={toggle}
                  pendingCode={pending}
                  visitedLabel={t.visited.mapVisited}
                  notVisitedLabel={t.visited.mapNotVisited}
                  untrackedLabel={t.visited.mapUntracked}
                />
              </div>

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
                <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                  {t.visited.shareHeading}
                </div>
                <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 14px", lineHeight: 1.5 }}>
                  {t.visited.shareBlurb}
                </p>

                {!shareUrl ? (
                  <button
                    onClick={getShareLink}
                    disabled={shareLoading}
                    className="font-mono btn-primary"
                    style={{
                      padding: "10px 16px",
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      cursor: shareLoading ? "default" : "pointer",
                    }}
                  >
                    {t.visited.getShareLinkButton}
                  </button>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      <input
                        readOnly
                        value={shareUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="font-mono"
                        style={{
                          flex: 1,
                          minWidth: 220,
                          background: "var(--bg-panel-raised)",
                          border: "1px solid var(--line-strong)",
                          borderRadius: 8,
                          padding: "10px 13px",
                          color: "var(--ink)",
                          fontSize: 12,
                          boxSizing: "border-box",
                        }}
                      />
                      <button
                        onClick={copyShareLink}
                        className="font-mono"
                        style={{
                          border: "1px solid var(--line)",
                          borderRadius: 999,
                          padding: "8px 16px",
                          fontSize: 12,
                          background: "transparent",
                          color: "var(--ink-soft)",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        {copied ? t.visited.linkCopied : t.visited.copyLinkButton}
                      </button>
                    </div>

                    <div
                      className="font-mono"
                      style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 6 }}
                    >
                      {t.visited.compareInputLabel}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        value={friendLink}
                        onChange={(e) => setFriendLink(e.target.value)}
                        placeholder={t.visited.compareInputPlaceholder}
                        className="font-mono"
                        style={{
                          flex: 1,
                          minWidth: 220,
                          background: "var(--bg-panel-raised)",
                          border: "1px solid var(--line-strong)",
                          borderRadius: 8,
                          padding: "10px 13px",
                          color: "var(--ink)",
                          fontSize: 12,
                          boxSizing: "border-box",
                          boxShadow: "inset 0 1px 3px rgba(43, 36, 28, 0.08)",
                        }}
                      />
                      <button
                        onClick={compareWithFriend}
                        disabled={!friendLink.trim()}
                        className="font-mono btn-primary"
                        style={{
                          padding: "10px 16px",
                          fontWeight: 700,
                          fontSize: 12,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          cursor: friendLink.trim() ? "pointer" : "default",
                          flexShrink: 0,
                        }}
                      >
                        {t.visited.compareButton}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 16px", lineHeight: 1.5 }}>
                {t.visited.mapSmallCountriesNote}
              </p>

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
