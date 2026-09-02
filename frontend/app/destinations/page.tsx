import type { Metadata } from "next";
import Link from "next/link";
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
  const title = `${t.pageTitle} - decide`;
  // The OG image itself (opengraph-image.tsx in this folder) stays
  // English-only regardless of language here - Next's file-convention
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
      <div style={{ padding: "18px clamp(32px, 8%, 180px) 0", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        {/* 1450, not this page's own 780px content width below - see the
            comment on ask/page.tsx's SiteHeader call for why the header
            stays pinned to the site-wide width regardless. Two rows,
            matching SiteHeader.tsx - see that file's header comment. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 14 }}>
            <Link href={`/${langSuffix}`} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
              <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
                decide
              </span>
            </Link>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <AccountControl language={language} t={t} />
              <div
                className="font-ui lang-toggle"
                style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
              >
                <Link
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
                </Link>
                <Link
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
                </Link>
              </div>
            </div>
          </div>
          <div className="header-nav-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <NavMenu t={t} language={language} />
          </div>
        </div>
      </div>

      <div style={{ padding: "40px clamp(32px, 8%, 180px) 72px" }}>
        {/* Outer 1450 matches the header above so this page's content
            starts at the same left edge as every other page's - see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1300 }}>
          <h1
            className="font-display"
            style={{ fontWeight: 600, fontSize: "clamp(28px, 4.5vw, 38px)", lineHeight: 1.2, margin: "0 0 14px", color: "var(--ink)" }}
          >
            {dt.pageTitle}
          </h1>
          {/* Responsive size (not a flat 15px) so a phone-width viewport gets
              more characters per line - at a fixed 15px this sentence wrapped
              to 4 lines on a phone, stranding "runs." alone on the last one;
              clamping down a couple px on narrow screens brings it back to 3. */}
          <p style={{ color: "var(--ink-dim)", fontSize: "clamp(13.5px, 3.4vw, 15px)", lineHeight: 1.6, maxWidth: 620, margin: "0 0 12px" }}>
            {dt.pageDescription.replace("{count}", String(destinations.length))}
          </p>
          <p className="font-ui" style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.6, marginBottom: 36 }}>
            {dt.notOnListNote}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
            {destinations.map((d) => (
              <Link
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
                  <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                    {dt.localNotesCount.replace("{count}", String(d.facts.length))}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Bottom CTA - after scrolling past a full grid of city cards
              (24 and counting) there was previously no way back to actually
              starting a trip without scrolling all the way back up to the
              header, which mattered most on a phone where that's a much
              longer scroll. */}
          <div style={{ marginTop: 40, paddingTop: 28, borderTop: "1px solid var(--line)", textAlign: "center" }}>
            <Link
              href={`/${langSuffix}`}
              className="font-ui btn-primary"
              style={{
                display: "inline-block",
                padding: "14px 26px",
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                textDecoration: "none",
              }}
            >
              {dt.ctaButton}
            </Link>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
