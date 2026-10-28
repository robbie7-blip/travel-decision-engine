import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The world city list is read from disk by /api/cities (lib/worldCities
  // .ts), which file tracing cannot see through a computed path, so it is
  // named here or the deployed function would not have it.
  outputFileTracingIncludes: {
    "/api/cities": ["./data/worldCities.json"],
    "/api/lodging-search": ["./data/worldCities.json"],
    // The share images read the city photo, the headline font and the
    // guide's facts from disk (lib/destinationOgImage.tsx,
    // lib/tripOgImage.tsx). Through a computed path tracing cannot see
    // them, and public/ is served by the CDN rather than bundled, so on
    // Vercel every share card was drawn without its photo or font.
    "/**/opengraph-image*": ["./public/destinations/**/*", "./lib/fonts/**/*", "./facts/**/*"],
    // The Instagram slides draw the same photo and font (lib/instagramSlides.tsx).
    "/api/admin/instagram/**": ["./public/destinations/**/*", "./lib/fonts/**/*"],
  },
  // /spin moved to /decide-for-me.
  //
  // The old path was named after the wheel, back when the wheel was the
  // whole feature. The dart and the globe are the default now and the
  // wheel is the alternative behind them, so the URL described something
  // the page no longer leads with - and the new name deliberately names
  // the JOB rather than the mechanism, because the mechanism has already
  // changed once and a path cannot be renamed for free.
  //
  // Permanent, and not optional. The page is linked from the trip form and
  // the nav, it is in people's history and bookmarks (this was reported
  // from a phone with the old URL in the address bar), and a moved page
  // that 404s is worse than one with an awkward name. Next carries the
  // query string across on its own, so /spin?lang=bg still arrives in
  // Bulgarian.
  // Not `async`, despite the name: Next accepts a plain array returned
  // from this hook, and an async function with nothing to await is a lint
  // error here (require-await) as well as a small lie about the function.
  redirects() {
    return Promise.resolve([
      { source: "/spin", destination: "/decide-for-me", permanent: true },
      // The Bulgarian destination guides moved from ?lang=bg on the English
      // page to their own address (/bg/destinations). Redirected here, not
      // in the page, so the English guides need no query string and are
      // built once as static pages. Next carries ?lang=bg across; the
      // Bulgarian page ignores it and its canonical link is the clean
      // address, so search engines index that one.
      {
        source: "/destinations",
        has: [{ type: "query", key: "lang", value: "bg" }],
        destination: "/bg/destinations",
        permanent: true,
      },
      {
        source: "/destinations/:slug",
        has: [{ type: "query", key: "lang", value: "bg" }],
        destination: "/bg/destinations/:slug",
        permanent: true,
      },
    ]);
  },
};

export default nextConfig;
