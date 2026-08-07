"use client";

// Just the collapsible link list + its mobile toggle, extracted out of
// SiteHeader so server-rendered pages (destinations/*, which switch
// language via a ?lang= URL param rather than client state, so they can't
// use SiteHeader's onLanguageChange callback directly) can still drop in
// the same full nav menu instead of hand-rolling their own header markup.

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function NavMenu({ t, language }: { t: Dictionary; language: Language }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const links = [
    { href: "/#how-it-works", label: t.howItWorks },
    { href: `/destinations${langSuffix}`, label: t.browseDestinations },
    { href: `/showcase${langSuffix}`, label: t.showcase.navLabel },
    { href: "/ask", label: t.tripQA.navLink },
    { href: "/account/visited", label: t.visited.homeNavLink },
    { href: "/pricing", label: t.account.navLink },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="nav-menu-toggle font-mono"
        aria-expanded={menuOpen}
        style={{
          border: "1px solid var(--line)",
          borderRadius: 999,
          padding: "6px 14px",
          fontSize: 12,
          letterSpacing: "0.04em",
          background: "transparent",
          color: "var(--ink-soft)",
          cursor: "pointer",
        }}
      >
        {menuOpen ? t.navMenuClose : t.navMenuOpen} {menuOpen ? "✕" : "☰"}
      </button>
      {/* gap is 0, not the old 20px — .nav-link below supplies its own
          spacing via padding + a divider border, so this row reads as
          distinct clickable items instead of one run of same-weight text
          with just whitespace between words. */}
      <div className={menuOpen ? "nav-links-row nav-links-row--open" : "nav-links-row"} style={{ alignItems: "center", gap: 0 }}>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="font-mono nav-link"
            style={{ fontSize: 12, letterSpacing: "0.04em", textDecoration: "none" }}
          >
            {link.label}
          </a>
        ))}
      </div>
    </>
  );
}
