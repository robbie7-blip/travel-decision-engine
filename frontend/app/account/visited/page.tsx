"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SiteHeader } from "@/components/SiteHeader";
import { VisitedMap } from "@/components/VisitedMap";
import { VisitedFlags } from "@/components/VisitedFlags";
import { VisitedTimeline } from "@/components/VisitedTimeline";
import { VisitedChronology } from "@/components/VisitedChronology";
import { VisitedZoomableMap } from "@/components/VisitedZoomableMap";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { COUNTRIES, countryFlagEmoji, CONTINENTS, getCountryName, getContinentName } from "@/lib/countries";
import { computeVisitedStats } from "@/lib/visited";
import {
  readLocalVisitedEntries,
  writeLocalVisitedEntries,
  peekLocalShareToken,
  getOrCreateLocalShareToken,
  type VisitedEntry,
  type VisitedPin,
} from "@/lib/localVisited";
import type { Language } from "@/lib/types";

// The globe renders to a WebGL canvas via three.js, which touches
// `document`/`window` at construction time — fatal during SSR. Both of
// these load it (VisitedPinsPanel embeds a VisitedGlobe internally), so
// both are loaded client-only, with a plain placeholder while the chunk
// downloads instead of nothing.
const VisitedGlobe = dynamic(() => import("@/components/VisitedGlobe").then((m) => m.VisitedGlobe), {
  ssr: false,
  loading: () => <GlobeLoadingPlaceholder />,
});
const VisitedPinsPanel = dynamic(() => import("@/components/VisitedPinsPanel").then((m) => m.VisitedPinsPanel), {
  ssr: false,
  loading: () => <GlobeLoadingPlaceholder />,
});

function GlobeLoadingPlaceholder() {
  return (
    <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-dim)", fontSize: 13 }}>
      <div className="font-mono">···</div>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A distinct brand color per badge instead of one uniform green for every
// milestone — same wider-use-of-the-existing-palette idea as TABS' colors
// below. Falls back to --accent-green for any future badge id that isn't
// listed here yet, so a new badge never renders with an undefined color.
const BADGE_COLORS: Record<string, string> = {
  first_stamp: "var(--brand-coral)",
  explorer: "var(--brand-teal)",
  globetrotter: "var(--brand-purple)",
  continent_hopper: "var(--brand-gold)",
  all_continents: "var(--brand-green)",
  half_the_world: "var(--brand-red)",
};

type Tab = "map" | "globe" | "zoomable" | "flags" | "timeline" | "chronology" | "pins";

/** The Been-style visited-countries tracker. Local-storage-first, same as
 * the Been app itself — marking a country visited needs no account, it
 * just needs to persist on this device (lib/localVisited.ts). Signing in
 * (handled inline, not a redirect to /account and back) is an optional
 * upgrade that syncs the same list to /api/visited so it also follows you
 * to another device — never a requirement to use the feature at all.
 *
 * Also the home of the "Visualize" tab row — Been-style alternate views
 * (Globe, Zoomable, Flags, Timeline, Chronology, Map Pins) of the exact
 * same underlying entries, not separate data. */
export default function VisitedPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [signedIn, setSignedIn] = useState(false);
  const [entries, setEntries] = useState<Record<string, VisitedEntry>>({});
  const [tab, setTab] = useState<Tab>("map");

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
    // signed-in account is a background upgrade: if one exists, its
    // entries win on any code both sides know (an existing account is
    // treated as the more authoritative copy once attached), and anything
    // local-only gets uploaded so the account catches up.
    const local = readLocalVisitedEntries();
    const localByCode = Object.fromEntries(local.map((e) => [e.code, e]));
    setEntries(localByCode);

    fetch("/api/visited")
      .then(async (r) => {
        if (!r.ok) return; // 401 not signed in, 500 misconfigured — either way, stay in local-only mode
        const data = await r.json();
        const serverEntries: VisitedEntry[] = data.entries ?? [];
        const serverByCode = Object.fromEntries(serverEntries.map((e) => [e.code, e]));
        const merged = { ...localByCode, ...serverByCode };
        setEntries(merged);
        writeLocalVisitedEntries(Object.values(merged));
        setSignedIn(true);
        for (const [code, entry] of Object.entries(localByCode)) {
          if (!(code in serverByCode)) {
            fetch("/api/visited", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code, visited: true, visitedAt: entry.visitedAt, pins: entry.pins }),
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const t = TRANSLATIONS[language];
  const v = t.visited.visualize;
  const codes = useMemo(() => new Set(Object.keys(entries)), [entries]);
  const entryList = useMemo(() => Object.values(entries), [entries]);
  const stats = useMemo(() => computeVisitedStats([...codes]), [codes]);

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  /** Every mutation below funnels through here: update state, persist
   * locally, and best-effort sync (account or anonymous share snapshot) —
   * one place for that fan-out instead of repeating it per action. */
  function applyEntries(next: Record<string, VisitedEntry>, changedCode: string) {
    setEntries(next);
    writeLocalVisitedEntries(Object.values(next));

    const changed = next[changedCode];
    if (signedIn) {
      fetch("/api/visited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: changedCode,
          visited: Boolean(changed),
          visitedAt: changed?.visitedAt,
          pins: changed?.pins,
        }),
      }).catch(() => {});
    } else if (peekLocalShareToken()) {
      fetch("/api/visited/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: peekLocalShareToken(), codes: Object.keys(next) }),
      }).catch(() => {});
    }
  }

  function toggle(code: string) {
    const next = { ...entries };
    if (next[code]) delete next[code];
    else next[code] = { code };
    applyEntries(next, code);
  }

  function setVisitedDate(code: string, visitedAt: string) {
    if (!entries[code]) return;
    applyEntries({ ...entries, [code]: { ...entries[code], visitedAt } }, code);
  }

  function addPin(code: string, pin: Omit<VisitedPin, "id">) {
    const existing = entries[code];
    if (!existing) return;
    const withId: VisitedPin = { ...pin, id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}` };
    applyEntries({ ...entries, [code]: { ...existing, pins: [...(existing.pins ?? []), withId] } }, code);
  }

  function removePin(code: string, pinId: string) {
    const existing = entries[code];
    if (!existing) return;
    applyEntries({ ...entries, [code]: { ...existing, pins: (existing.pins ?? []).filter((p) => p.id !== pinId) } }, code);
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

  // A distinct brand color per tab (Been-app-style playful tab row, per the
  // original inspiration for this whole visualize feature) rather than one
  // uniform green for every active state — cycles through the same 6 brand
  // colors already used for the logo/confidence tiers elsewhere, so it's a
  // wider use of the existing palette, not a new one invented just for this.
  const TABS: { id: Tab; label: string; color: string }[] = [
    { id: "map", label: v.tabMap, color: "var(--brand-teal)" },
    { id: "globe", label: v.tabGlobe, color: "var(--brand-coral)" },
    { id: "zoomable", label: v.tabZoomable, color: "var(--brand-gold)" },
    { id: "flags", label: v.tabFlags, color: "var(--brand-purple)" },
    { id: "timeline", label: v.tabTimeline, color: "var(--brand-green)" },
    { id: "chronology", label: v.tabChronology, color: "var(--brand-red)" },
    { id: "pins", label: v.tabPins, color: "var(--brand-teal)" },
  ];

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Explicit 1280 (was implicitly using SiteHeader's 860 default) so
          this matches the rest of the site's header width exactly instead
          of by coincidence — see the comment on ask/page.tsx's SiteHeader
          call for why headers don't need to match their own page's
          narrower content column. */}
      <SiteHeader
        language={language}
        onLanguageChange={setLanguage}
        t={t}
        maxWidth={1280}
        contextLink={{ href: "/account", label: t.visited.backToAccount }}
      />

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          {/* Page H1 uses the brand teal (same color as the "decide"
           * wordmark in SiteHeader) as a consistent signature accent across
           * every page's title — body copy/labels below stay --ink-dim/
           * --ink for readability, color is deliberately scoped to just
           * the heading. */}
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px", color: "var(--brand-teal)" }}>
            {t.visited.pageHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 24px", lineHeight: 1.5 }}>{t.visited.pageSubheading}</p>

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
                <div className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "var(--brand-teal)" }}>
                  {stats.countriesVisited}
                </div>
                <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                  {t.visited.statsCountries.replace("{count}", String(stats.countriesVisited))}
                </div>
              </div>
              <div>
                <div className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "var(--brand-coral)" }}>
                  {stats.percentOfWorld}%
                </div>
                <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                  {t.visited.statsPercent.replace("{percent}", String(stats.percentOfWorld))}
                </div>
              </div>
              <div>
                <div className="font-display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: "var(--brand-purple)" }}>
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
                      border: `1px solid ${BADGE_COLORS[id] ?? "var(--accent-green)"}`,
                      color: BADGE_COLORS[id] ?? "var(--accent-green)",
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

          {/* Visualize tab row — same underlying entries, different view. */}
          <div className="font-mono scroll-row-mobile" style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {TABS.map((tabDef) => (
              <button
                key={tabDef.id}
                type="button"
                onClick={() => setTab(tabDef.id)}
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  borderRadius: 999,
                  border: `1px solid ${tab === tabDef.id ? tabDef.color : "var(--line)"}`,
                  background: tab === tabDef.id ? tabDef.color : "var(--bg-panel)",
                  color: tab === tabDef.id ? "var(--bg-panel)" : "var(--ink-soft)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 0.15s ease, border-color 0.15s ease",
                }}
              >
                {tabDef.label}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 28 }}>
            {tab === "map" && (
              <VisitedMap
                visitedCodes={codes}
                onToggle={toggle}
                pendingCode={null}
                visitedLabel={t.visited.mapVisited}
                notVisitedLabel={t.visited.mapNotVisited}
                untrackedLabel={t.visited.mapUntracked}
                language={language}
              />
            )}
            {tab === "globe" && (
              <VisitedGlobe
                visitedCodes={codes}
                onToggleCountry={toggle}
                visitedLabel={t.visited.mapVisited}
                notVisitedLabel={t.visited.mapNotVisited}
                untrackedLabel={t.visited.mapUntracked}
                language={language}
              />
            )}
            {tab === "zoomable" && (
              <VisitedZoomableMap
                visitedCodes={codes}
                onToggle={toggle}
                visitedLabel={t.visited.mapVisited}
                notVisitedLabel={t.visited.mapNotVisited}
                untrackedLabel={t.visited.mapUntracked}
                language={language}
                hint={v.zoomableHint}
              />
            )}
            {tab === "flags" && <VisitedFlags codes={[...codes]} onToggle={toggle} emptyLabel={v.flagsEmpty} language={language} />}
            {tab === "timeline" && (
              <VisitedTimeline
                entries={entryList}
                onSetDate={setVisitedDate}
                emptyLabel={v.timelineEmpty}
                dateUnknownLabel={v.timelineDateUnknown}
                setDateLabel={v.timelineSetDate}
                locale={language === "bg" ? "bg-BG" : "en-US"}
                language={language}
              />
            )}
            {tab === "chronology" && (
              <VisitedChronology
                entries={entryList}
                undatedLabel={v.chronologyUndated}
                countLabel={v.chronologyCountLabel}
                language={language}
              />
            )}
            {tab === "pins" && (
              <VisitedPinsPanel entries={entryList} onAddPin={addPin} onRemovePin={removePin} t={t.visited} language={language} />
            )}
          </div>

          {tab === "map" && (
            <>
              <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 16px", lineHeight: 1.5 }}>
                {t.visited.mapSmallCountriesNote}
              </p>

              {CONTINENTS.map((continent) => (
                <div key={continent} style={{ marginBottom: 28 }}>
                  <div
                    className="font-mono"
                    style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 10 }}
                  >
                    {getContinentName(continent, language)}
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
                          {getCountryName(c.code, language)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Below the full checklist, not competing with it for
               * attention at the top of the tab — comparing with a friend
               * is a nice-to-have on top of the tracker, not part of using
               * it. */}
              <div
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 20,
                  boxShadow: "var(--shadow-panel)",
                  marginTop: 12,
                }}
              >
                <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                  {t.visited.shareHeading}
                </div>
                <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 14px", lineHeight: 1.5 }}>{t.visited.shareBlurb}</p>

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
            </>
          )}

          {/* Sync is an optional upgrade, not a requirement to use any of
           * the above — kept at the bottom, out of the way, rather than
           * gating the page like a login wall. */}
          {!signedIn && (
            <div
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 20,
                boxShadow: "var(--shadow-panel)",
                marginTop: 12,
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
        </div>
      </div>
    </div>
  );
}
