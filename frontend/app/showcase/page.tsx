// Public gallery of real, already-generated trips (see lib/showcase.ts) —
// curated via /admin/showcase, same "grounded, not fabricated" reasoning as
// the single homepage demo link (lib/demoTrip.ts): only real generations
// ever appear here, never a mocked-up example. Reads Redis directly (no
// separate /api/showcase route) since this page is the only consumer, same
// as /admin/feedback.

import type { Metadata } from "next";
import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { loadJob } from "@/lib/loadJob";
import { computeTrustScore } from "@/lib/trustScore";
import { SHOWCASE_LIST_KEY, type ShowcaseTrip } from "@/lib/showcase";
import { AccountControl } from "@/components/AccountControl";
import { Stamp } from "@/components/ui";
import { NavMenu } from "@/components/NavMenu";
import { TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export const dynamic = "force-dynamic"; // always fresh, never statically cached
export const runtime = "nodejs";

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

interface ShowcaseCard {
  jobId: string;
  destinations: string[];
  tripSummary: string;
  budgetFeasible: boolean;
  trustPercent: number;
  dayCount: number;
}

function trustScoreColor(percent: number): string {
  if (percent >= 80) return "var(--grounded)";
  if (percent >= 50) return "var(--unverified)";
  return "var(--infeasible)";
}

async function loadShowcaseCards(): Promise<ShowcaseCard[]> {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return [];
  }

  const raw = await redis.lrange<string | ShowcaseTrip>(SHOWCASE_LIST_KEY, 0, -1);
  const stored = raw.map((r) => (typeof r === "string" ? (JSON.parse(r) as ShowcaseTrip) : r));

  // Newest first, and re-validated against the live job on every read (same
  // as /api/demo-trip) so an expired job just quietly drops off the gallery
  // instead of showing a dead link.
  const cards: ShowcaseCard[] = [];
  for (const entry of [...stored].reverse()) {
    const job = await loadJob(entry.jobId);
    if (!job || job.status !== "done" || !job.result) continue;
    cards.push({
      jobId: entry.jobId,
      destinations: entry.destinations,
      tripSummary: job.result.trip_summary,
      budgetFeasible: job.result.budget_feasibility.feasible,
      trustPercent: computeTrustScore(job.result).percent,
      dayCount: job.result.days?.length ?? 0,
    });
  }
  return cards;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang } = await searchParams;
  const st = TRANSLATIONS[resolveLanguage(lang)].showcase;
  const title = `${st.pageTitle} — decide`;
  return {
    title,
    description: st.pageDescription,
    openGraph: { title, description: st.pageDescription },
    twitter: { title, description: st.pageDescription },
  };
}

export default async function ShowcasePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const language = resolveLanguage(lang);
  const t = TRANSLATIONS[language];
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  const cards = await loadShowcaseCards();

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "18px clamp(32px, 8%, 180px) 0", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        {/* 1450, not this page's own 960px content width below — see the
            comment on ask/page.tsx's SiteHeader call for why. Two rows,
            matching SiteHeader.tsx — see that file's header comment. */}
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
                  href="/showcase"
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
                  href="/showcase?lang=bg"
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
            starts at the same left edge as every other page's — see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1300 }}>
          <h1
            className="font-display"
            style={{ fontWeight: 600, fontSize: "clamp(28px, 4.5vw, 38px)", lineHeight: 1.2, margin: "0 0 14px", color: "var(--brand-teal)" }}
          >
            {t.showcase.pageTitle}
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: "0 0 36px" }}>
            {t.showcase.pageDescription}
          </p>

          {cards.length === 0 && (
            <p style={{ color: "var(--ink-dim)", fontSize: 14 }}>{t.showcase.emptyState}</p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {cards.map((card) => (
              <Link
                key={card.jobId}
                href={`/trip/${card.jobId}`}
                className="hover-card"
                style={{
                  display: "block",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: "18px 18px 16px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div className="font-display" style={{ fontSize: 19, fontWeight: 600, marginBottom: 8, color: "var(--ink)" }}>
                  {card.destinations.join(" · ")}
                </div>
                <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 12 }}>
                  {t.showcase.daysLabel.replace("{count}", String(card.dayCount))}
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)", margin: "0 0 14px" }}>
                  {card.tripSummary}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <Stamp ok={card.budgetFeasible}>
                    {card.budgetFeasible ? t.result.budgetFeasible : t.result.budgetNotFeasible}
                  </Stamp>
                  <Stamp ok color={trustScoreColor(card.trustPercent)}>
                    {card.trustPercent}% {t.result.trustScoreLabel}
                  </Stamp>
                </div>
                <div className="font-ui" style={{ fontSize: 12, color: "var(--grounded)" }}>
                  {t.showcase.viewTrip}
                </div>
              </Link>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
