import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DestinationBanner } from "@/components/DestinationBanner";
import { listDestinations, listDestinationSlugs, loadDestination, type DestinationFact } from "@/lib/destinations";
import { DESTINATION_INTROS } from "@/lib/destinationIntros";

export function generateStaticParams() {
  return listDestinationSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const destination = loadDestination(slug);
  if (!destination) return {};

  const title = `${destination.city} travel notes — decide`;
  const description = `What decide already knows about ${destination.city} before it even runs a live search: getting around, real costs, and what locals skip.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

// Friendly label + accent color per curated-fact category. Colors reuse the
// same CSS variables the rest of the app uses for the same meaning —
// tourist-trap warnings get the same tone as a budget-integrity warning.
const CATEGORY_META: Record<string, { label: string; color: string }> = {
  transit: { label: "Getting around", color: "var(--grounded)" },
  cost: { label: "What things cost", color: "var(--accent-1)" },
  dietary: { label: "Dietary notes", color: "var(--tier-single-source)" },
  tourist_trap_warning: { label: "Tourist-trap watch", color: "var(--infeasible)" },
  activity: { label: "Worth knowing", color: "var(--accent-2)" },
  practical: { label: "Practical", color: "var(--ink-dim)" },
};

function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? { label: category, color: "var(--ink-dim)" };
}

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

export default async function DestinationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const destination = loadDestination(slug);
  if (!destination) notFound();

  const groups = groupByCategory(destination.facts);
  const intro = DESTINATION_INTROS[slug];

  const all = listDestinations().sort((a, b) => a.city.localeCompare(b.city));
  const currentIndex = all.findIndex((d) => d.slug === slug);
  const more =
    currentIndex === -1
      ? all.slice(0, 3)
      : [all[(currentIndex + 1) % all.length], all[(currentIndex + 2) % all.length], all[(currentIndex + 3) % all.length]];

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
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
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
            <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--ink)" }}>
              decide
            </span>
          </a>
          <a
            href="/destinations"
            className="font-mono"
            style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none", marginLeft: "auto" }}
          >
            ← All destinations
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "36px auto 0", padding: "0 24px" }}>
        <DestinationBanner city={destination.city} slug={slug} />
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
            A few things decide already knows about {destination.city} before it even runs a live search — grounded
            background, not a substitute for the price checks a real itinerary still runs.
          </p>

          {groups.map(({ category, items }) => {
            const meta = categoryMeta(category);
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
                    color: meta.color,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: meta.color,
                      flexShrink: 0,
                    }}
                  />
                  {meta.label}
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
            Read more on Wikipedia ↗
          </a>

          <div style={{ marginTop: 40, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
            <a
              href={`/?dest=${encodeURIComponent(destination.city)}`}
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
              Plan a trip to {destination.city} →
            </a>
            <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 14, lineHeight: 1.6 }}>
              decide isn&apos;t limited to these cities — tell it any destination and it runs the same live price
              checks either way.
            </p>
          </div>

          {more.length > 0 && (
            <div style={{ marginTop: 48 }}>
              <div
                className="font-mono"
                style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 14 }}
              >
                More destination guides
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                {more.map((d) => (
                  <a
                    key={d.slug}
                    href={`/destinations/${d.slug}`}
                    className="hover-card"
                    style={{
                      display: "block",
                      borderRadius: 10,
                      overflow: "hidden",
                      border: "1px solid var(--line)",
                      textDecoration: "none",
                    }}
                  >
                    <DestinationBanner city={d.city} slug={d.slug} compact />
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
