"use client";

// Just the collapsible link list + its mobile toggle, extracted out of
// SiteHeader so server-rendered pages (destinations/*, which switch
// language via a ?lang= URL param rather than client state, so they can't
// use SiteHeader's onLanguageChange callback directly) can still drop in
// the same full nav menu instead of hand-rolling their own header markup.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

// One small monoline glyph per nav item — the plain-text pills read as flat
// and generic on the pages where nothing is "active" yet (the homepage:
// none of the hrefs match "/", so every link sits at the same visual
// weight with nothing to distinguish it). All six share one stroke width
// and use currentColor rather than their own fixed hue, so each icon rides
// the exact same color transitions .nav-link already had (--ink-soft at
// rest, --color-blue on hover, white on the active teal fill) instead of
// turning the bar into a rainbow of per-item accent colors.
const ICON_PROPS = { viewBox: "0 0 24 24", "aria-hidden": true, style: { width: 15, height: 15, flexShrink: 0 } } as const;
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const NAV_ICONS: Record<string, ReactNode> = {
  whyDecide: (
    <svg {...ICON_PROPS}>
      <path {...STROKE} d="M9 18h6M10 21h4M8 10a4 4 0 1 1 8 0c0 2-1.5 2.8-2 4.5-.1.5-.3.5-.5.5h-3c-.2 0-.4 0-.5-.5C9.5 12.8 8 12 8 10Z" />
    </svg>
  ),
  destinations: (
    <svg {...ICON_PROPS}>
      <path {...STROKE} d="M12 21s-6.5-6.1-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.9-6.5 11-6.5 11Z" />
      <circle {...STROKE} cx="12" cy="10" r="2.3" />
    </svg>
  ),
  showcase: (
    <svg {...ICON_PROPS}>
      <rect {...STROKE} x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path {...STROKE} d="m3.5 15 4.5-4.5 3 3 3.5-4 5.5 5.5" />
      <circle cx="8" cy="9" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  ask: (
    <svg {...ICON_PROPS}>
      <path {...STROKE} d="M4 5.5h16v10H9.5L6 19v-3.5H4Z" />
      <path {...STROKE} d="M8 9.5h8M8 12h5" />
    </svg>
  ),
  visited: (
    <svg {...ICON_PROPS}>
      <path {...STROKE} d="M6 3v18" />
      <path {...STROKE} d="M6 4h11l-2.5 3.5L17 11H6" />
    </svg>
  ),
  pricing: (
    <svg {...ICON_PROPS}>
      <path {...STROKE} d="M12.5 3.5H19a1 1 0 0 1 1 1v6.5a1 1 0 0 1-.3.7l-8 8a1 1 0 0 1-1.4 0l-6.5-6.5a1 1 0 0 1 0-1.4l8-8a1 1 0 0 1 .7-.3Z" />
      <circle cx="16" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export function NavMenu({ t, language }: { t: Dictionary; language: Language }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const links = [
    { href: `/why-decide${langSuffix}`, label: t.whyDecide.navLink, icon: NAV_ICONS.whyDecide },
    { href: `/destinations${langSuffix}`, label: t.browseDestinations, icon: NAV_ICONS.destinations },
    { href: `/showcase${langSuffix}`, label: t.showcase.navLabel, icon: NAV_ICONS.showcase },
    { href: "/ask", label: t.tripQA.navLink, icon: NAV_ICONS.ask },
    { href: "/account/visited", label: t.visited.homeNavLink, icon: NAV_ICONS.visited },
    { href: "/pricing", label: t.account.navLink, icon: NAV_ICONS.pricing },
  ];

  // Strip the ?lang= suffix each href may carry before comparing to the
  // current route — pathname never includes it.
  function isActive(href: string): boolean {
    const path = href.split("?")[0];
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="nav-menu-toggle font-ui"
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
          <Link
            key={link.href}
            href={link.href}
            className="font-ui nav-link"
            data-active={isActive(link.href)}
            style={{ fontSize: 12, letterSpacing: "0.04em", textDecoration: "none", gap: 6 }}
          >
            {link.icon}
            {link.label}
          </Link>
        ))}
      </div>
    </>
  );
}
