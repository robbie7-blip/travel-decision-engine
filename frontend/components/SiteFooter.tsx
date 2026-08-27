// The standard Terms/Privacy/Cookies/Contact footer strip most sites carry
// (mirrors what Booking/Ryanair etc. put at the very bottom of every page)
// — this site had no sitewide footer at all before. Mounted once in
// app/layout.tsx so it's on every page, unlike TrustFooter.tsx (the
// homepage's own "why trust us" strip, a different kind of content that
// doesn't belong on every page).
//
// Plain server component, no language toggle — the three pages it links to
// (/terms, /privacy, /cookies) are English-only (see their own top-of-file
// comments for why), so labeling the links themselves in whatever language
// the rest of a given page happens to be in would be inconsistent with
// what you'd actually land on.

import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/legal";

const YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <div
      className="font-ui"
      style={{
        padding: "20px clamp(32px, 8%, 180px)",
        borderTop: "1px solid var(--line)",
        display: "flex",
        flexWrap: "wrap",
        gap: "10px 20px",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: "var(--ink-dim)",
      }}
    >
      <span>© {YEAR} decide. All rights reserved.</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <Link href="/terms" style={{ color: "var(--ink-dim)" }}>
          Terms
        </Link>
        <Link href="/privacy" style={{ color: "var(--ink-dim)" }}>
          Privacy
        </Link>
        <Link href="/cookies" style={{ color: "var(--ink-dim)" }}>
          Cookies
        </Link>
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "var(--ink-dim)" }}>
          Contact
        </a>
      </div>
    </div>
  );
}
