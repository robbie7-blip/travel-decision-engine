import type { Metadata } from "next";
import { AccountControl } from "@/components/AccountControl";
import { DestinationHero } from "@/components/DestinationHero";
import { NavMenu } from "@/components/NavMenu";
import { getLocalizedCityName, listDestinations } from "@/lib/destinations";
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
  const t = TRANSLATIONS[resolveLanguage(lang)].destinations;
  const title = `${t.pageTitle} — decide`;
  // The OG image itself (opengraph-image.tsx in this folder) stays
  // English-only regardless of language here — Next's file-convention
  // image routes don't receive searchParams at all, so there's no ?lang=
  // value to forward to it. See that file's header for the confirmed
  // Next.js limitation.
  return {
    title,
    description: t.metaIndexDescription,
    openGraph: { title, description: t.metaIndexDescription },
    twitter: { title, description: t.metaIndexDescription },
  };
}

export default async function DestinationsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const language = resolveLanguage(lang);
  const t = TRANSLATIONS[language];
  const dt = t.destinations;
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const destinations = listDestinations()
    .map((d) => ({ ...d, displayCity: getLocalizedCityName(d.slug, language, d.city) }))
    .sort((a, b) => a.displayCity.localeCompare(b.displayCity, language));

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "20px 0", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        {/* 1450, not this page's own 780px content width below — see the
            comment on ask/page.tsx's SiteHeader call for why the header
            stays pinned to the site-wide width regardless. */}
        <div
          style={{
            maxWidth: 1450,
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
          }}
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
              href="/destinations"
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
              href="/destinations?lang=bg"
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

      <div style={{ padding: "40px 0 72px" }}>
        {/* Outer 1450 matches the header above so this page's content
            starts at the same left edge as every other page's — see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 780 }}>
          <h1
            className="font-display"
            style={{ fontWeight: 600, fontSize: "clamp(28px, 4.5vw, 38px)", lineHeight: 1.2, margin: "0 0 14px", color: "var(--brand-teal)" }}
          >
            {dt.pageTitle}
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: "0 0 12px" }}>
            {dt.pageDescription.replace("{count}", String(destinations.length))}
          </p>
          <p className="font-mono" style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.6, marginBottom: 36 }}>
            {dt.notOnListNote}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
            {destinations.map((d) => (
              <a
                key={d.slug}
                href={`/destinations/${d.slug}${langSuffix}`}
                className="hover-card"
                style={{
                  display: "block",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  overflow: "hidden",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <DestinationHero city={d.displayCity} slug={d.slug} compact eyebrow={dt.eyebrow} />
                <div style={{ padding: "10px 14px 14px" }}>
                  <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                    {dt.localNotesCount.replace("{count}", String(d.facts.length))}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
