"use client";

// Just the collapsible link list + its mobile toggle, extracted out of
// SiteHeader so server-rendered pages (destinations/*, which switch
// language via a ?lang= URL param rather than client state, so they can't
// use SiteHeader's onLanguageChange callback directly) can still drop in
// the same full nav menu instead of hand-rolling their own header markup.

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function NavMenu({ t, language }: { t: Dictionary; language: Language }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const links = [
    { href: `/why-decide${langSuffix}`, label: t.whyDecide.navLink },
    { href: "/#how-it-works", label: t.howItWorks },
    { href: `/destinations${langSuffix}`, label: t.browseDestinations },
    { href: `/showcase${langSuffix}`, label: t.showcase.navLabel },
    { href: "/ask", label: t.tripQA.navLink },
    { href: "/account/visited", label: t.visited.homeNavLink },
    { href: "/pricing", label: t.account.navLink },
  ];

  // Strip the ?lang= suffix each href may carry before comparing to the
  // current route — pathname never includes it. A same-page hash link
  // (just "#how-it-works" on the homepage) is never treated as "active":
  // it's a scroll target, not a route, and stripping its hash down to "/"
  // would otherwise make it falsely light up as "the current page"
  // whenever pathname is "/" — including while looking at the trip form
  // above it, nowhere near that section.
  function isActive(href: string): boolean {
    if (href.includes("#")) return false;
    const path = href.split("?")[0];
    return pathname === path || pathname.startsWith(`${path}/`);
  }

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
      {/* gap 4px — .nav-link is now a standalone pill (background + radius,
          see globals.css), not divider-separated running text, so it needs
          a little breathing room between items instead of the old 0. */}
      <div className={menuOpen ? "nav-links-row nav-links-row--open" : "nav-links-row"} style={{ alignItems: "center", gap: 4 }}>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="font-mono nav-link"
            data-active={isActive(link.href)}
            style={{ fontSize: 12, letterSpacing: "0.04em", textDecoration: "none" }}
          >
            {link.label}
          </a>
        ))}
      </div>
    </>
  );
}
