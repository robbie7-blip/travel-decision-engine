import type { MetadataRoute } from "next";
import { listDestinationSlugs } from "@/lib/destinations";
import { getSiteUrl } from "@/lib/siteUrl";
import { destinationAlternates } from "@/lib/destinationPaths";
import { getDb } from "@/lib/db";
import { listPublished } from "@/lib/tripsQuery";

// Read on each request: published trips come and go, and a sitemap built
// once at deploy time would miss every trip published after it.
export const dynamic = "force-dynamic";

// Next.js App Router convention: this file's presence auto-generates
// /sitemap.xml at the site root - no manual XML, no separate route file.
// Exists mainly for the /destinations guides (see destinations.ts): they
// were built to bring in organic search traffic, and without a sitemap
// search engines only find them by crawling links rather than being told
// about them directly.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
  ];

  // Each guide in both languages, each its own page (the Bulgarian ones
  // at /bg/destinations), each naming the other as its alternate.
  const guide = (language: "en" | "bg", slug?: string) => ({
    url: destinationAlternates(siteUrl, language, slug).canonical,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: slug ? 0.6 : 0.8,
    alternates: { languages: destinationAlternates(siteUrl, language, slug).languages },
  });
  const destinationRoutes: MetadataRoute.Sitemap = [
    guide("en"),
    guide("bg"),
    ...listDestinationSlugs().flatMap((slug) => [guide("en", slug), guide("bg", slug)]),
  ];

  // Trips their travellers published (/plans). A database that is down or
  // not configured leaves them out rather than failing the whole sitemap.
  const db = getDb();
  const published = db ? await listPublished(db, 1000).catch(() => []) : [];
  const planRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/plans`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    ...published.map((trip) => ({
      url: `${siteUrl}/plans/${trip.slug}`,
      lastModified: new Date(trip.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];

  return [...staticRoutes, ...destinationRoutes, ...planRoutes];
}
