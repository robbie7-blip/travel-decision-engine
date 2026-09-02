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
//
// Two rows, not one — logo + account controls on row 1, the full nav on
// its own row 2 below a divider. A single combined row (logo + 7 nav
// links + account pill + language toggle, more on the homepage with the
// currency switcher too) needs ~1500px+ to lay out without cramming,
// which is wider than a lot of ordinary laptop browser windows — it kept
// either overflowing/wrapping badly or forcing an early collapse to a
// bare hamburger button that looked sparse next to reference sites
// (Booking.com, Ryanair) that never collapse this early because THEIR
// headers are two rows too (logo+account on top, nav tabs below). Splitting
// the same way here means each row only needs roughly half the width, so
// the full nav now stays visible inline down to a much narrower window
// instead of vanishing into "Menu ☰" the moment things got tight.

import type { ReactNode } from "react";
import Link from "next/link";
import { AccountControl } from "./AccountControl";
import { NavMenu } from "./NavMenu";
import { LANGUAGE_NAMES } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface SiteHeaderProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  t: Dictionary;
  /** "large" is the homepage's own hero lockup (big logo + tagline);
   * every other page uses the default compact treatment. Both are now
   * two rows — large just has a bigger row 1. */
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
  // 1450 matches the header width every page now passes explicitly (see
  // ask/page.tsx's SiteHeader call for the full reasoning) — CompareStatsView
  // is the one remaining caller that relies on this default rather than
  // passing its own maxWidth, so it needs to move in step with the rest.
  maxWidth = 1450,
}: SiteHeaderProps) {
  const large = variant === "large";
  const langSuffix = language === "bg" ? "?lang=bg" : "";
  const linkStyle = { fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" } as const;

  return (
    <div
      style={{
        padding: large ? "28px clamp(32px, 8%, 180px) 0" : "18px clamp(32px, 8%, 180px) 0",
        background: "var(--bg-panel-raised)",
        borderBottom: `1px solid ${large ? "var(--line-strong)" : "var(--line)"}`,
      }}
    >
      <div style={{ maxWidth: large ? 1550 : maxWidth, margin: "0 auto" }}>
        {/* Row 1: logo (+ tagline on large) on the left, every account/
            language/context control on the right — no nav here, so this
            row's own space need is small regardless of how many nav links
            exist. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: large ? 22 : 16,
            paddingBottom: large ? 20 : 14,
          }}
        >
          <Link href={`/${langSuffix}`} style={{ display: "flex", alignItems: "center", gap: large ? 22 : 12, textDecoration: "none" }}>
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
                  className="font-ui"
                  style={{
                    fontSize: "clamp(10px, 2.6vw, 14px)",
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    // Ink, not coral. The mark below the wordmark keeps the
                    // coral dot; the tagline no longer echoes it. A coral
                    // line of caps directly under a serif wordmark on a warm
                    // ground was doing more than its share of the
                    // resemblance this redesign is undoing.
                    color: "var(--ink-dim)",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    marginTop: 8,
                  }}
                >
                  {t.tagline}
                </div>
              )}
            </div>
          </Link>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            {contextLink && (
              <Link href={contextLink.href} className="font-ui header-context-link" style={linkStyle}>
                {contextLink.label}
              </Link>
            )}
            {extraControls}
            <AccountControl language={language} t={t} />
            <div className="font-ui lang-toggle" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
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

        {/* Row 2: the full nav, on its own line — same visual pattern as
            Booking.com's tab strip below its own top bar. Only this row's
            content (7 links) has to fit the available width, which is why
            it can stay inline much further down than the old combined row
            could. */}
        <div
          className="header-nav-row"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            borderTop: "1px solid var(--line)",
            padding: "10px 0",
          }}
        >
          <NavMenu t={t} language={language} />
        </div>
      </div>
    </div>
  );
}
