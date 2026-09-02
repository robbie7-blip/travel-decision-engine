"use client";

// The header's nav, split across the two header rows but sharing one piece
// of state.
//
// The "Menu" button used to sit in the second row with the links it opens,
// which on a phone left it alone on its own line under a divider, below a
// first row that still had room for it. It read as a leftover rather than a
// control. It now sits in the first row next to Sign in and the language
// toggle, and the second row disappears entirely until the menu is opened.
//
// Two components rather than one because the pages that use them are server
// components: they can render a client provider and two client children,
// but they cannot hold the open/closed state themselves. The context is
// what lets the button in row one drive the panel in row two.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { NavMenu, NAV_LINKS_ID } from "./NavMenu";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface HeaderNavState {
  open: boolean;
  toggle: () => void;
}

const HeaderNavContext = createContext<HeaderNavState>({ open: false, toggle: () => {} });

export function HeaderNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, toggle: () => setOpen((v) => !v) }), [open]);
  return <HeaderNavContext.Provider value={value}>{children}</HeaderNavContext.Provider>;
}

/** Row one. Hidden on desktop by .nav-menu-toggle in globals.css, where the
 * full nav is inline and there is nothing to toggle. */
export function HeaderNavToggle({ t }: { t: Dictionary }) {
  const { open, toggle } = useContext(HeaderNavContext);
  return (
    <button
      type="button"
      onClick={toggle}
      className="nav-menu-toggle font-ui"
      aria-expanded={open}
      aria-controls={NAV_LINKS_ID}
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
      {open ? t.navMenuClose : t.navMenuOpen} {open ? "✕" : "☰"}
    </button>
  );
}

/** Row two: the divider and the links. On desktop this is the nav bar and
 * is always visible. On mobile the --collapsed modifier removes it from the
 * layout, so a closed menu leaves no empty bordered strip behind. */
export function HeaderNavRow({ t, language }: { t: Dictionary; language: Language }) {
  const { open } = useContext(HeaderNavContext);
  return (
    <div
      className={`header-nav-row${open ? "" : " header-nav-row--collapsed"}`}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        borderTop: "1px solid var(--line)",
        padding: "10px 0",
      }}
    >
      <NavMenu t={t} language={language} open={open} />
    </div>
  );
}
