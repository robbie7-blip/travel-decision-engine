// The destination guides index, in either language. Routes:
// app/destinations (English) and app/bg/destinations (Bulgarian).

import type { Metadata } from "next";
import Link from "next/link";
import { AccountControl } from "@/components/AccountControl";
import { HomeChip } from "@/components/HomeChip";
import { DestinationHero } from "@/components/DestinationHero";
import { HeaderNavProvider, HeaderNavRow, HeaderNavToggle } from "@/components/HeaderNav";
import { getLocalizedCityName, listDestinations } from "@/lib/destinations";
import { TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { getSiteUrl } from "@/lib/siteUrl";
import { destinationAlternates, destinationsPath } from "@/lib/destinationPaths";

export function destinationsIndexMetadata(language: Language): Metadata {
  const t = TRANSLATIONS[language].destinations;
  const title = `${t.pageTitle} - decide`;
  return {
    title,
    description: t.metaIndexDescription,
    alternates: destinationAlternates(getSiteUrl(), language),
    openGraph: { title, description: t.metaIndexDescription, locale: language === "bg" ? "bg_BG" : "en_GB" },
    twitter: { title, description: t.metaIndexDescription },
  };
}

export function DestinationsIndex({ language }: { language: Language }) {
  const t = TRANSLATIONS[language];
  const dt = t.destinations;
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const destinations = listDestinations()
    .map((d) => ({ ...d, displayCity: getLocalizedCityName(d.slug, language, d.city) }))
    .sort((a, b) => a.displayCity.localeCompare(b.displayCity, language));

  return (
    <div lang={language} style={{ minHeight: "100%" }}>
      <div className="site-header" style={{ padding: "18px clamp(32px, 8%, 180px) 0", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        {/* 1450, not this page's own 780px content width below - see the
            comment on ask/page.tsx's SiteHeader call for why the header
            stays pinned to the site-wide width regardless. Two rows,
            matching SiteHeader.tsx - see that file's header comment. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
          <HeaderNavProvider>
          <div className="site-header-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 14 }}>
            <Link href={`/${langSuffix}`} className="header-logo" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
              <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
                decide
              </span>
            </Link>
            <div className="site-header-right" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              {/* The way back to the trip form, in words.
                  
                  The logo has always linked home and still does, on every
                  page - but "click the wordmark" is a convention you have
                  to already know, and these eight pages hand-roll their
                  header rather than using SiteHeader, so they were the
                  ones with no context link at all. SiteHeader puts one
                  exactly here, first inside the right-hand group; this is
                  the same slot, the same style and the same class, so the
                  responsive rule that gives it its own line on a narrow
                  screen already applies.
                  
                  Labelled "Plan your own trip", not "Home". The homepage
                  IS the trip form, so the label that helps says what you
                  get rather than where you go - and it is the label the
                  trip, ask and compare pages already use for this exact
                  link. */}
              <Link
                href={`/${langSuffix}`}
                className="font-ui header-context-link"
                style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}
              >
                {t.trip.planAnother} &rarr;
              </Link>
              <div className="header-account-group">
              <AccountControl language={language} t={t} />
              <div className="font-ui lang-toggle header-chip header-chip--segmented">
                <Link href={destinationsPath("en")} data-active={language === "en"}>
                  EN
                </Link>
                <Link href={destinationsPath("bg")} data-active={language === "bg"}>
                  BG
                </Link>
              </div>
              {/* Inside .header-account-group, not beside it. See that
                  rule in globals.css for what the box is for;
                  check:header-group is what keeps every hand-rolled copy
                  of this header honest about it. */}
              <HomeChip language={language} t={t} />
              <HeaderNavToggle t={t} />
              </div>
            </div>
          </div>
          <HeaderNavRow t={t} language={language} />
          </HeaderNavProvider>
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
                href={destinationsPath(language, d.slug)}
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
