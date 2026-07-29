import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/siteUrl";

// Next.js App Router convention: this file's presence auto-generates
// /robots.txt at the site root. /admin/* is already behind HTTP Basic Auth
// (see middleware.ts) so this isn't a security boundary — it just keeps
// crawlers from wasting crawl budget on pages they can't get past a 401 on
// anyway, and from indexing bare job-not-found/loading states under /trip
// (those pages are meant to be found via their own shared link, not search).
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/", "/trip/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
