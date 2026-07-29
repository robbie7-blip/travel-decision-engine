import type { MetadataRoute } from "next";
import { listDestinationSlugs } from "@/lib/destinations";
import { getSiteUrl } from "@/lib/siteUrl";

// Next.js App Router convention: this file's presence auto-generates
// /sitemap.xml at the site root — no manual XML, no separate route file.
// Exists mainly for the /destinations guides (see destinations.ts): they
// were built to bring in organic search traffic, and without a sitemap
// search engines only find them by crawling links rather than being told
// about them directly.
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/destinations`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];

  // Each guide is also reachable with ?lang=bg (see DESTINATION_CITY_NAMES_BG
  // etc.) — that's a query-param variant of the same URL, not a distinct
  // path, so it's surfaced via `alternates.languages` rather than as its own
  // sitemap entry.
  const destinationRoutes: MetadataRoute.Sitemap = listDestinationSlugs().map((slug) => ({
    url: `${siteUrl}/destinations/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
    alternates: {
      languages: {
        en: `${siteUrl}/destinations/${slug}`,
        bg: `${siteUrl}/destinations/${slug}?lang=bg`,
      },
    },
  }));

  return [...staticRoutes, ...destinationRoutes];
}
