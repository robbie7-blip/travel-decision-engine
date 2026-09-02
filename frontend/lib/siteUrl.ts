// Shared production-URL resolution - used by the root layout (metadataBase,
// for absolute OG/twitter image URLs) and by sitemap.ts/robots.ts, which
// both need real absolute URLs rather than relative paths.

/** Vercel injects these automatically at build/runtime - no manual env
 * setup needed. Prefers the stable production domain over the current
 * deployment's own URL so preview-deploy builds still generate links
 * pointing at production, not at themselves. */
export function getSiteUrl(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
