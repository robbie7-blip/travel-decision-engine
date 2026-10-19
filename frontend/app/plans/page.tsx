// Every trip its traveller chose to publish, newest first.

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { listPublished } from "@/lib/tripsQuery";
import { TRANSLATIONS } from "@/lib/i18n";
import { SHARE_CARD } from "@/lib/shareCard";
import type { Language } from "@/lib/types";
import { RoutedSiteHeader } from "@/components/RoutedSiteHeader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { lang } = await searchParams;
  const t = TRANSLATIONS[lang === "bg" ? "bg" : "en"].plans;
  const title = `${t.indexTitle} - decide`;
  return { title, description: t.indexIntro, openGraph: { title, description: t.indexIntro, ...SHARE_CARD } };
}

export default async function PlansIndexPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const language: Language = lang === "bg" ? "bg" : "en";
  const t = TRANSLATIONS[language];
  const db = getDb();
  const trips = db ? await listPublished(db).catch(() => []) : [];

  return (
    <div style={{ minHeight: "100%" }}>
      <RoutedSiteHeader language={language} contextLink={{ href: language === "bg" ? "/?lang=bg" : "/", label: `${t.trip.planAnother} →` }} />
      <main className="plan-page">
        <h1 className="font-display plan-title">{t.plans.indexTitle}</h1>
        <p className="plan-summary">{t.plans.indexIntro}</p>
        {trips.length === 0 ? (
          <p className="font-ui plan-note">{t.plans.empty}</p>
        ) : (
          <ul className="plan-list">
            {trips.map((trip) => (
              <li key={trip.slug}>
                <Link href={`/plans/${trip.slug}`} className="plan-card">
                  <span className="font-display plan-card-title">{trip.title}</span>
                  <span className="font-ui plan-card-meta">
                    {(trip.party ? t.plans.metaParty.replace("{party}", trip.party) : t.plans.meta).replace("{days}", String(trip.dayCount))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
