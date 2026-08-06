import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DestinationHero } from "@/components/DestinationHero";
import { NavMenu } from "@/components/NavMenu";
import {
  getDestinationPhoto,
  getLocalizedCityName,
  getLocalizedFacts,
  listDestinations,
  listDestinationSlugs,
  loadDestination,
  type DestinationFact,
} from "@/lib/destinations";
import { DESTINATION_INTROS } from "@/lib/destinationIntros";
import { TRANSLATIONS } from "@/lib/i18n";
import { getSiteUrl } from "@/lib/siteUrl";
import type { Language } from "@/lib/types";

export function generateStaticParams() {
  return listDestinationSlugs().map((slug) => ({ slug }));
}

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { lang } = await searchParams;
  const destination = loadDestination(slug);
  if (!destination) return {};

  const language = resolveLanguage(lang);
  const t = TRANSLATIONS[language].destinations;
  const displayCity = getLocalizedCityName(slug, language, destination.city);
  const title = t.metaDetailTitle.replace("{city}", displayCity);
  const description = t.metaDetailDescription.replace("{city}", displayCity);
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

// Colors reuse the same CSS variables the rest of the app uses for the same
// meaning — tourist-trap warnings get the same tone as a budget-integrity
// warning — independent of language; only the label text is translated.
const CATEGORY_COLOR: Record<string, string> = {
  transit: "var(--grounded)",
  cost: "var(--accent-1)",
  dietary: "var(--tier-single-source)",
  tourist_trap_warning: "var(--infeasible)",
  activity: "var(--accent-2)",
  practical: "var(--ink-dim)",
};

function groupByCategory(facts: DestinationFact[]): Array<{ category: string; items: string[] }> {
  const order: string[] = [];
  const groups: Record<string, string[]> = {};
  for (const fact of facts) {
    if (!groups[fact.category]) {
      groups[fact.category] = [];
      order.push(fact.category);
    }
    groups[fact.category].push(fact.text);
  }
  return order.map((category) => ({ category, items: groups[category] }));
}

export default async function DestinationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const { lang } = await searchParams;
  const destination = loadDestination(slug);
  if (!destination) notFound();

  const language = resolveLanguage(lang);
  const t = TRANSLATIONS[language];
  const dt = t.destinations;
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const displayCity = getLocalizedCityName(slug, language, destination.city);
  const facts = getLocalizedFacts(slug, language, destination.facts);
  const groups = groupByCategory(facts);
  const intro = DESTINATION_INTROS[language][slug];
  const photo = getDestinationPhoto(slug);

  const all = listDestinations()
    .map((d) => ({ ...d, displayCity: getLocalizedCityName(d.slug, language, d.city) }))
    .sort((a, b) => a.displayCity.localeCompare(b.displayCity, language));
  const currentIndex = all.findIndex((d) => d.slug === slug);
  const more =
    currentIndex === -1
      ? all.slice(0, 3)
      : [all[(currentIndex + 1) % all.length], all[(currentIndex + 2) % all.length], all[(currentIndex + 3) % all.length]];

  // Structured data for search engines — a lightweight TouristDestination
  // entry, not a substitute for the meta description above, just a machine-
  // readable version of the same facts for rich-result eligibility.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TouristDestination",
    name: displayCity,
    description: dt.metaDetailDescription.replace("{city}", displayCity),
    url: `${getSiteUrl()}/destinations/${slug}`,
  };

  return (
    <div style={{ minHeight: "100%" }}>
      <script
        type="application/ld+json"
        // JSON.stringify already escapes for JSON; the extra </ escape is
        // defense in depth against breaking out of the script tag, though
        // none of our (fixed, curated) inputs actually contain it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div style={{ padding: "20px 24px", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        <div
          style={{
            maxWidth: 780,
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
          <div className="header-nav-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginLeft: "auto" }}>
            <a
              href={`/destinations${langSuffix}`}
              className="font-mono"
              style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}
            >
              {dt.backToAll}
            </a>
            <NavMenu t={t} language={language} />
            <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
            <div
              className="font-mono lang-toggle"
              style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
            >
              <a
                href={`/destinations/${slug}`}
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
                href={`/destinations/${slug}?lang=bg`}
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

      <div style={{ maxWidth: 780, margin: "36px auto 0", padding: "0 24px" }}>
        <DestinationHero city={displayCity} slug={slug} eyebrow={dt.eyebrow} />
        {photo?.credit && (
          <p className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
            {dt.photoCredit}{" "}
            <a href={photo.credit.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              {photo.credit.artist}
            </a>{" "}
            · {photo.credit.license}
          </p>
        )}
      </div>

      <div style={{ padding: "32px 24px 72px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          {intro && (
            <p
              className="font-display"
              style={{
                fontStyle: "italic",
                fontSize: 20,
                lineHeight: 1.55,
                color: "var(--ink-soft)",
                margin: "0 0 24px",
                maxWidth: 640,
              }}
            >
              {intro}
            </p>
          )}
          <p style={{ color: "var(--ink-dim)", fontSize: 14, lineHeight: 1.6, maxWidth: 620, margin: "0 0 40px" }}>
            {dt.introDisclaimer.replace("{city}", displayCity)}
          </p>

          {groups.map(({ category, items }) => {
            const color = CATEGORY_COLOR[category] ?? "var(--ink-dim)";
            const label =
              dt.categoryLabels[category as keyof typeof dt.categoryLabels] ?? category;
            return (
              <div key={category} style={{ marginBottom: 32 }}>
                <div
                  className="font-mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  {label}
                </div>
                {items.map((text, i) => (
                  <div
                    key={i}
                    className="hover-card"
                    style={{ padding: "12px 10px", marginTop: -1, borderTop: "1px solid var(--line)", fontSize: 14, lineHeight: 1.6 }}
                  >
                    {text}
                  </div>
                ))}
              </div>
            );
          })}

          <a
            href={`https://en.wikipedia.org/wiki/${encodeURIComponent(destination.city)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono"
            style={{ fontSize: 12, color: "var(--grounded)", textDecoration: "underline" }}
          >
            {dt.readMoreWikipedia}
          </a>

          <div style={{ marginTop: 40, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
            <a
              href={`/?dest=${encodeURIComponent(destination.city)}${language === "bg" ? "&lang=bg" : ""}`}
              className="font-mono btn-primary"
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
              {dt.planTrip.replace("{city}", displayCity)}
            </a>
            <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 14, lineHeight: 1.6 }}>
              {dt.notLimitedNote}
            </p>
          </div>

          {more.length > 0 && (
            <div style={{ marginTop: 48 }}>
              <div
                className="font-mono"
                style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 14 }}
              >
                {dt.moreGuides}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                {more.map((d) => (
                  <a
                    key={d.slug}
                    href={`/destinations/${d.slug}${langSuffix}`}
                    className="hover-card"
                    style={{
                      display: "block",
                      borderRadius: 10,
                      overflow: "hidden",
                      border: "1px solid var(--line)",
                      textDecoration: "none",
                    }}
                  >
                    <DestinationHero city={d.displayCity} slug={d.slug} compact eyebrow={dt.eyebrow} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
