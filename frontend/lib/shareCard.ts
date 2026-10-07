// The share image, for pages that declare their own openGraph block.
//
// THE TRAP THIS EXISTS FOR. app/opengraph-image.tsx is picked up by Next's
// file convention and injected into any page that does NOT set
// `openGraph` in its own metadata. A page that sets one - usually to give
// sharing a better description than the site-wide sentence - replaces the
// INHERITED openGraph object wholesale, image included, because metadata
// merges shallowly per field. The page then advertises
// `twitter:card = summary_large_image` (set once in app/layout.tsx) with
// no image at all.
//
// An image file in the page's OWN segment is not affected: /destinations
// declares openGraph and has app/destinations/opengraph-image.tsx, and it
// serves that card correctly. Only the inherited one is lost.
//
// Nothing warns about it. Measured on the built site, six pages were in
// that state - /decide-for-me, /why-decide, /showcase, /terms, /privacy
// and /cookies - and the correlation with "declares its own openGraph"
// was exact.
//
// So: spread SHARE_CARD into any openGraph block, and scripts/
// checkShareCard.mjs fails the build if a page forgets.
//
// Relative on purpose. metadataBase in app/layout.tsx turns it absolute,
// which is what makes it correct on a preview deployment as well as in
// production - a hardcoded https://yourdecide.com image on a Vercel
// preview would show the live card for whatever the branch changed.

// Not `as const`: that makes `images` a readonly tuple and Next's
// OpenGraph type wants a mutable OGImage[], so the spread fails to
// typecheck at every call site.
export const SHARE_CARD: { images: string[] } = {
  images: ["/opengraph-image"],
};
