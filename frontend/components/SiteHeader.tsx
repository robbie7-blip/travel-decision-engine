"use client";

// Single shared header for every page — was previously hand-duplicated
// across 10+ files, each showing only ONE contextual link (e.g. "Plan
// another trip →" on /trip/[id], "Places you've been →" on /account) with
// no way to reach anywhere else without going back to the homepage first.
// Confirmed confusing in practice: from most pages there was no path to
// Destination guides, Ask a Local, or Pricing at all. Every page now gets
// the full link set via the same mobile-collapsible menu the homepage
// already uses (.nav-menu-toggle/.nav-links-row in globals.css) — a page
// can still show its own extra context link (contextLink prop) alongside
// it, it just isn't the ONLY way to navigate anymore.

import type { ReactNode } from "react";
import { AccountControl } from "./AccountControl";
import { NavMenu } from "./NavMenu";
import { LANGUAGE_NAMES } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface SiteHeaderProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  t: Dictionary;
  /** "large" is the homepage's own hero lockup (big logo + tagline,
   * wrapped in its own bottom border); every other page uses the default
   * compact treatment. */
  variant?: "compact" | "large";
  /** Extra control rendered next to the language switcher — currently
   * only the homepage/trip pages' CurrencySwitcher. */
  extraControls?: ReactNode;
  /** An additional page-specific link shown alongside the full menu
   * (e.g. "Plan another trip →" on a result page) — kept because it's
   * often the single most relevant action on that page, not a
   * replacement for real navigation. Pass the label pre-formatted with
   * whatever arrow (or none) it should show — existing translation
   * strings aren't consistent about embedding a trailing "→" vs. a
   * leading "←" vs. neither, so this renders the label verbatim rather
   * than guessing/appending one itself. */
  contextLink?: { href: string; label: string };
  maxWidth?: number;
}

export function SiteHeader({
  language,
  onLanguageChange,
  t,
  variant = "compact",
  extraControls,
  contextLink,
  // 1280 matches the header width every page now passes explicitly (see
  // ask/page.tsx's SiteHeader call for the full reasoning) — CompareStatsView
  // is the one remaining caller that relies on this default rather than
  // passing its own maxWidth, so it needs to move in step with the rest.
  maxWidth = 1280,
}: SiteHeaderProps) {
  const large = variant === "large";
  const langSuffix = language === "bg" ? "?lang=bg" : "";
  const linkStyle = { fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" } as const;

  return (
    <div
      style={{
        padding: large ? "28px 24px 12px" : "20px 24px",
        background: "var(--bg-panel-raised)",
        borderBottom: `1px solid ${large ? "var(--line-strong)" : "var(--line)"}`,
      }}
    >
      {/* 1400 (not 960) for the large variant specifically — its bigger
          84px logo + 48px wordmark plus the extra currency-switcher
          control need more room than the compact header's nav content
          does before nav + currency + language toggle stop fitting on
          one line (measured need: ~1297px). The homepage's own body
          content below stays at its own narrower 960, same pattern as
          every other page's header being wider than that page's content
          column — see ask/page.tsx's SiteHeader call. */}
      <div style={{ maxWidth: large ? 1400 : maxWidth, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: large ? 22 : 16,
            ...(large ? { paddingBottom: 24, marginBottom: 26, borderBottom: "1px solid var(--line)" } : {}),
          }}
        >
          <a href={`/${langSuffix}`} style={{ display: "flex", alignItems: "center", gap: large ? 22 : 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={large ? 84 : 40} height={large ? 84 : 40} style={{ flexShrink: 0 }} />
            <div>
              <div
                className="font-display"
                style={{ fontSize: large ? 48 : 24, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}
              >
                decide
              </div>
              {large && (
                <div
                  className="font-mono"
                  style={{
                    fontSize: "clamp(10px, 2.6vw, 14px)",
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    color: "var(--accent-1)",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    marginTop: 8,
                  }}
                >
                  {t.tagline}
                </div>
              )}
            </div>
          </a>

          {/* contextLink sits here, next to the logo, rather than inside
              header-nav-row below — it used to be the first child of that
              row, which has marginLeft:auto and renders as one right-flush
              block. Since contextLink's text length (or absence) varied
              per page ("← Back to account" / "Your account →" / none),
              that block's total width varied too, which shifted where
              "How it works" started on every page even though the *right*
              edge (language toggle) always lined up. Pulling contextLink
              out means header-nav-row's content (nav + divider + language
              toggle) is now identical on every page that renders it, so it
              is pixel-identically positioned everywhere, not just
              right-edge-aligned. */}
          {contextLink && (
            <a href={contextLink.href} className="font-mono header-context-link" style={linkStyle}>
              {contextLink.label}
            </a>
          )}

          <div className="header-nav-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20, marginLeft: "auto" }}>
            <NavMenu t={t} language={language} />
            <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {extraControls}
              <AccountControl language={language} t={t} />
              <div className="font-mono lang-toggle" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
                {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => onLanguageChange(lang)}
                    data-active={language === lang}
                    style={{
                      border: "none",
                      padding: "6px 12px",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      background: "transparent",
                      color: "var(--ink-dim)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
