// A confident, specific comparison against "just ask a chatbot to plan my
// trip" — every claim here maps to something the product actually does
// (confidence tiers in ItineraryResult.tsx, live price checks in the
// worker, the Stamp budget-feasibility badge), not just an assertion that
// decide is "better." Static marketing content, so this is a server
// component with real metadata (same pattern as /showcase and
// /destinations) rather than a client component — worth being crawlable.

import type { Metadata } from "next";
import { AccountControl } from "@/components/AccountControl";
import { NavMenu } from "@/components/NavMenu";
import { TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang } = await searchParams;
  const wd = TRANSLATIONS[resolveLanguage(lang)].whyDecide;
  const title = `${wd.pageTitle} — decide`;
  const description = `${wd.subheadGeneric} ${wd.subheadDecide}`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function WhyDecidePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const language = resolveLanguage(lang);
  const t = TRANSLATIONS[language];
  const wd = t.whyDecide;
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "20px 0", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        {/* 1450, not this page's own 780px content width below — see the
            comment on ask/page.tsx's SiteHeader call for why. */}
        <div
          style={{ maxWidth: 1450, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}
        >
          <a href={`/${langSuffix}`} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
            <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
              decide
            </span>
          </a>
          <div className="header-nav-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20, marginLeft: "auto" }}>
            <NavMenu t={t} language={language} />
            <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
            <AccountControl language={language} t={t} />
            <div
              className="font-mono lang-toggle"
              style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
            >
              <a
                href="/why-decide"
                data-active={language === "en"}
                style={{
                  padding: "6px 12px",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  textDecoration: "none",
                  background: "transparent",
                  color: "var(--ink-dim)",
                }}
              >
                EN
              </a>
              <a
                href="/why-decide?lang=bg"
                data-active={language === "bg"}
                style={{
                  padding: "6px 12px",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  textDecoration: "none",
                  background: "transparent",
                  color: "var(--ink-dim)",
                }}
              >
                BG
              </a>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "48px 0 32px", borderBottom: "1px solid var(--line)" }}>
        {/* Outer 1450 matches the header above so this page's content
            starts at the same left edge as every other page's — see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          <h1
            className="font-display gradient-text"
            style={{
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: "clamp(30px, 5vw, 44px)",
              lineHeight: 1.2,
              paddingBottom: 4,
              margin: "0 0 16px",
            }}
          >
            {wd.headlineLine1}
            <br />
            {wd.headlineLine2}
          </h1>
          {/* Same ×/✓ language as the comparison rows below, as a two-line
              teaser instead of one flowing sentence — previews the page's
              whole argument before the reader even scrolls to the table. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 620 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden style={{ color: "var(--tier-inferred)", flexShrink: 0, fontSize: 14, lineHeight: 1.6 }}>
                ×
              </span>
              <p style={{ color: "var(--ink-dim)", fontSize: 16, lineHeight: 1.6, margin: 0 }}>{wd.subheadGeneric}</p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden style={{ color: "var(--color-blue)", fontWeight: 700, flexShrink: 0, fontSize: 14, lineHeight: 1.6 }}>
                ✓
              </span>
              <p style={{ color: "var(--ink)", fontWeight: 500, fontSize: 16, lineHeight: 1.6, margin: 0 }}>{wd.subheadDecide}</p>
            </div>
          </div>
        </div>
        </div>
      </div>

      <div style={{ padding: "40px 0", borderBottom: "1px solid var(--line)" }}>
        {/* Same 1450-outer fix as the hero section above. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {/* Column headers, hidden on mobile where each row stacks to a
              single column anyway (see the 700px media rule below) — the
              "GENERIC" vs "DECIDE" framing is carried by each cell's own
              styling at that width instead. */}
          <div
            className="font-mono why-decide-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 12,
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
            }}
          >
            <div>{wd.columnHeadingGeneric}</div>
            <div style={{ color: "var(--color-blue)", fontWeight: 700 }}>{wd.columnHeadingDecide}</div>
          </div>

          {wd.rows.map((row, i) => (
            <div key={i} style={{ marginBottom: 28 }}>
              <div className="font-display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>
                {row.title}
              </div>
              <div className="why-decide-columns" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div
                  style={{
                    background: "var(--bg-panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "14px 16px",
                    display: "flex",
                    gap: 10,
                  }}
                >
                  <span aria-hidden style={{ color: "var(--tier-inferred)", flexShrink: 0, fontSize: 14, lineHeight: "1.5" }}>
                    ×
                  </span>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-soft)", margin: 0 }}>{row.generic}</p>
                </div>
                <div
                  style={{
                    background: "color-mix(in srgb, var(--color-blue) 6%, white)",
                    border: "1.5px solid var(--color-blue)",
                    borderRadius: 8,
                    padding: "14px 16px",
                    display: "flex",
                    gap: 10,
                  }}
                >
                  <span aria-hidden style={{ color: "var(--color-blue)", flexShrink: 0, fontSize: 14, lineHeight: "1.5", fontWeight: 700 }}>
                    ✓
                  </span>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)", margin: 0, fontWeight: 500 }}>{row.decide}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>

      <div style={{ padding: "48px 0 64px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto", textAlign: "center" }}>
          <h2 className="font-display" style={{ fontSize: "clamp(22px, 3.5vw, 28px)", fontWeight: 600, margin: "0 0 24px", color: "var(--ink)" }}>
            {wd.ctaHeading}
          </h2>
          <a
            href={`/${langSuffix}`}
            className="font-mono btn-primary"
            style={{
              display: "inline-block",
              textDecoration: "none",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {wd.ctaButton}
          </a>
        </div>
      </div>
    </div>
  );
}
