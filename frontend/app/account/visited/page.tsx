"use client";

import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { VisitedMap } from "@/components/VisitedMap";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { COUNTRIES, countryFlagEmoji, CONTINENTS } from "@/lib/countries";
import { computeVisitedStats } from "@/lib/visited";
import { readLocalVisitedCodes, writeLocalVisitedCodes, peekLocalShareToken, getOrCreateLocalShareToken } from "@/lib/localVisited";
import type { Language } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The Been-style visited-countries tracker. Local-storage-first, same as
 * the Been app itself — marking a country visited needs no account, it
 * just needs to persist on this device (lib/localVisited.ts). Signing in
 * (handled inline, not a redirect to /account and back) is an optional
 * upgrade that syncs the same list to /api/visited so it also follows you
 * to another device — never a requirement to use the feature at all. */
export default function VisitedPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [signedIn, setSignedIn] = useState(false);
  const [codes, setCodes] = useState<Set<string>>(new Set());

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

    // This device's list renders immediately — no network wait, since it's
    // the source of truth for anyone who never signs in. Checking for a
    // signed-in account is a background upgrade: if one exists, its list is
    // merged in (union of both, so neither device loses anything) and any
    // code that was only local gets uploaded so the account catches up.
    const local = readLocalVisitedCodes();
    setCodes(new Set(local));

    fetch("/api/visited")
      .then(async (r) => {
        if (!r.ok) return; // 401 not signed in, 500 misconfigured — either way, stay in local-only mode
        const data = await r.json();
        const serverCodes: string[] = data.codes ?? [];
        const serverSet = new Set(serverCodes);
        const merged = new Set([...local, ...serverCodes]);
        setCodes(merged);
        writeLocalVisitedCodes([...merged]);
        setSignedIn(true);
        for (const code of local) {
          if (!serverSet.has(code)) {
            fetch("/api/visited", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code, visited: true }),
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const t = TRANSLATIONS[language];
  const stats = useMemo(() => computeVisitedStats([...codes]), [codes]);

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  function toggle(code: string) {
    const nowVisited = !codes.has(code);
    const next = new Set(codes);
    if (nowVisited) next.add(code);
    else next.delete(code);
    setCodes(next);
    writeLocalVisitedCodes([...next]);

    if (signedIn) {
      // Best-effort background sync — local storage already has the
      // durable copy for this device, so a failed request here just means
      // the account catches up next time this succeeds, not a lost toggle.
      fetch("/api/visited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, visited: nowVisited }),
      }).catch(() => {});
    } else if (peekLocalShareToken()) {
      // A share link for this device already exists — keep its snapshot
      // current so anyone who has it sees this toggle too.
      fetch("/api/visited/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: peekLocalShareToken(), codes: [...next] }),
      }).catch(() => {});
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
      // Signed in: the account's server-issued token, no body needed.
      // Not signed in: this device's own token (minted on first use here),
      // with the current list uploaded as its snapshot.
      const res = signedIn
        ? await fetch("/api/visited/share")
        : await fetch("/api/visited/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: getOrCreateLocalShareToken(), codes: [...codes] }),
          });
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

          {!signedIn && (
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
                  pendingCode={null}
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
                            cursor: "pointer",
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
        </div>
      </div>
    </div>
  );
}
