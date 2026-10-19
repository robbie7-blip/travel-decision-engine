// A trip its traveller chose to publish (see app/api/trip-publish). Read
// straight from Postgres: the page is a copy that outlives the trip, and
// it is server-rendered so search engines read the whole plan.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPublished } from "@/lib/tripsQuery";
import { TRANSLATIONS } from "@/lib/i18n";
import { getSiteUrl } from "@/lib/siteUrl";
import { affiliateIds, hasAffiliates } from "@/lib/bookingLinks";
import { RoutedSiteHeader } from "@/components/RoutedSiteHeader";
import { PublishedPlan } from "@/components/PublishedPlan";
import { TripMap } from "@/components/TripMap";
import { publicItinerary } from "@/lib/publicPlan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function load(slug: string) {
  const db = getDb();
  if (!db || slug.length > 140) return null;
  try {
    return await getPublished(db, slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const trip = await load(slug);
  if (!trip) return { title: "decide" };
  const title = `${trip.title} - decide`;
  // Never the stored summary: pages published before lib/publicPlan.ts
  // still hold the traveller's own, which can be personal.
  const description = TRANSLATIONS[trip.language].plans.description.replace("{title}", trip.title);
  return {
    title,
    description,
    alternates: { canonical: `${getSiteUrl()}/plans/${trip.slug}` },
    // No images here: the route's own opengraph-image.tsx is the card.
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublishedTripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await load(slug);
  if (!trip) notFound();
  const t = TRANSLATIONS[trip.language];
  // Cleaned on the way out too, for pages published before the cleaning
  // existed (lib/publicPlan.ts).
  const itinerary = publicItinerary(trip.itinerary);
  const langSuffix = trip.language === "bg" ? "&lang=bg" : "";
  const meta = (trip.party ? t.plans.metaParty.replace("{party}", trip.party) : t.plans.meta).replace("{days}", String(trip.dayCount));

  return (
    <div style={{ minHeight: "100%" }}>
      <RoutedSiteHeader language={trip.language} contextLink={{ href: "/plans", label: `${t.plans.browse} →` }} />
      <main className="plan-page">
        <p className="font-ui plan-eyebrow">{trip.destinations.join(" · ")}</p>
        <h1 className="font-display plan-title">{trip.title}</h1>
        <p className="font-ui plan-meta">{meta}</p>
        <p className="plan-summary">{t.plans.description.replace("{title}", trip.title)}</p>
        <p>
          <Link
            href={`/?dest=${encodeURIComponent(trip.destinations.join(", "))}${langSuffix}`}
            className="font-ui btn-primary plan-cta"
          >
            {t.plans.cta}
          </Link>
        </p>
        {Array.isArray(itinerary.days) && itinerary.days.length > 1 && <TripMap days={itinerary.days} t={t} />}
        <PublishedPlan itinerary={itinerary} destinations={trip.destinations} t={t} />
        <p className="font-ui plan-note">{t.plans.note}</p>
        {hasAffiliates(affiliateIds()) && <p className="font-ui plan-note">{t.result.booking.disclosure}</p>}
      </main>
    </div>
  );
}
