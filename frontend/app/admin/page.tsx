"use client";

// Index for /admin, which previously 404'd — every tool lived at
// /admin/<something> and the bare path pointed at nothing, so the obvious
// URL to type was the one that didn't work.
//
// It also fixes a quieter trap. The owner-only UI scattered around the app
// (the "Add to showcase" button on a trip, the generation-timings panel)
// keys off a localStorage flag set by visiting an admin page — but only the
// CLIENT admin pages could ever set it, since it's localStorage. /admin/stats
// and /admin/feedback are server components, so visiting either of those,
// the two most natural places to go, silently left the flag unset and the
// owner-only UI invisible with no hint as to why. This page is a client
// component that sets the flag and links to everything, so "go to /admin"
// is now a single instruction that always works.

import { useEffect } from "react";
import Link from "next/link";
import { markAdminUi } from "@/lib/adminUi";

const TOOLS: { href: string; name: string; blurb: string }[] = [
  {
    href: "/admin/stats",
    name: "Stats",
    blurb: "Usage counters, conversion funnel, and today's spend against the daily budget.",
  },
  {
    href: "/admin/feedback",
    name: "Feedback",
    blurb: "Every line item a traveler flagged as right or wrong.",
  },
  {
    href: "/admin/showcase",
    name: "Showcase gallery",
    blurb: "Curate the real trips shown on /showcase.",
  },
  {
    href: "/admin/demo-trip",
    name: "Homepage demo",
    blurb: "Point the homepage's “see a real example” link at a real generated trip.",
  },
  {
    href: "/admin/test-mode",
    name: "Test mode",
    blurb: "Generate without burning rate limits, quotas, or the daily spend cap.",
  },
];

export default function AdminIndexPage() {
  useEffect(() => {
    // Reaching this page at all means middleware.ts already required the
    // admin password, so recording it here is safe — same reasoning as the
    // other admin pages that do this.
    markAdminUi();
  }, []);

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", color: "var(--ink)" }}>
      <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
        Admin
      </h1>
      <p style={{ color: "var(--ink-dim)", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
        This browser is now marked as the owner&apos;s, which turns on the owner-only controls elsewhere in the app:
        the <strong style={{ color: "var(--ink)" }}>+ Add to showcase</strong> button on any trip, and the{" "}
        <strong style={{ color: "var(--ink)" }}>generation timings</strong> panel at the bottom of a finished trip.
        Nothing here is visible to travelers.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            style={{
              display: "block",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "12px 14px",
              textDecoration: "none",
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ color: "var(--grounded)", fontSize: 14 }}>{tool.name} →</div>
            <div style={{ color: "var(--ink-dim)", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{tool.blurb}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
