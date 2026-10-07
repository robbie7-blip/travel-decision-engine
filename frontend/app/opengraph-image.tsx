// The share image for every page that does not make its own.
//
// Three routes already did - /trip/[jobId], /destinations and
// /destinations/[slug] - which is why this gap was easy to miss: sharing a
// trip or a guide, the things most likely to be shared, looked right. Every
// other page did not. The homepage, /ask, /decide-for-me and /pricing are
// the ones someone links to when they are telling a person about the
// product at all.
//
// And the failure was the loud kind rather than the quiet one. The root
// metadata sets `twitter.card = "summary_large_image"` (app/layout.tsx)
// with no image anywhere, so those pages were not falling back to a small
// card with a favicon - they were promising a 1200x630 image and supplying
// nothing.
//
// Next resolves this file by segment: the closest opengraph-image wins, so
// the three routes above keep their own and this covers the rest. Nothing
// in them changes.
//
// Deliberately NOT a photograph or an illustration of anywhere. The product
// has 24 real photographs of real cities and its whole argument is that it
// does not pretend; a generic travel image on the card that introduces it
// would be the first thing it did pretend. The mark, the sentence, and the
// colours the site is actually made of.
//
// English-only, and that is a limitation of the file convention rather
// than a choice - see the note in app/destinations/opengraph-image.tsx:
// this function is only ever passed `params`, never `searchParams`, so
// ?lang=bg cannot reach it. A per-locale card needs a Route Handler.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const alt = "decide - it doesn't list options, it decides";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The mark, inline rather than read from public/logo-icon.svg.
 *
 * Satori (what ImageResponse renders with) does not fetch or resolve
 * external SVG files, and the other two cards in this app already carry
 * their own copy for the same reason. Kept identical to theirs so three
 * share images cannot drift into three logos. */
const MARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="l" x1="18" y1="15" x2="50" y2="72" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e8a23f"/>
      <stop offset="1" stop-color="#8a7d68"/>
    </linearGradient>
    <linearGradient id="r" x1="82" y1="15" x2="50" y2="72" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e8a23f"/>
      <stop offset="1" stop-color="#8a7d68"/>
    </linearGradient>
    <linearGradient id="m" x1="50" y1="10" x2="50" y2="72" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4f9a72"/>
      <stop offset="1" stop-color="#2c6a4c"/>
    </linearGradient>
  </defs>
  <path d="M18 15 Q 34 40 50 72" fill="none" stroke="url(#l)" stroke-width="3.5" stroke-linecap="round" opacity="0.65"/>
  <path d="M82 15 Q 66 40 50 72" fill="none" stroke="url(#r)" stroke-width="3.5" stroke-linecap="round" opacity="0.65"/>
  <path d="M50 10 L 50 72" fill="none" stroke="url(#m)" stroke-width="4.5" stroke-linecap="round" opacity="0.85"/>
  <circle cx="50" cy="78" r="8" fill="#d9643f"/>
</svg>`;
const MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

export default async function SiteOgImage() {
  // Same optional-font handling as the other two cards: a missing file
  // falls back to the renderer's default rather than failing the build.
  // A share image that does not render is worse than one in the wrong
  // face, and this runs at build time for static routes.
  let literata: Buffer | null = null;
  try {
    literata = await readFile(join(process.cwd(), "lib/fonts/literata-600.ttf"));
  } catch {
    literata = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f7f1e2",
          padding: "60px 72px",
          fontFamily: literata ? "Literata" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img width={52} height={52} src={MARK_DATA_URI} alt="" />
          <span style={{ fontSize: 28, fontWeight: 600, color: "#2c6a4c" }}>decide</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 24,
          }}
        >
          {/* The site's own sentence, not a description of it. It is six
              words and it is the product's entire argument. */}
          <div
            style={{
              display: "flex",
              fontSize: 76,
              fontWeight: 600,
              color: "#2b241c",
              lineHeight: 1.12,
              maxWidth: 940,
            }}
          >
            It doesn&apos;t list options. It decides.
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#4a4136", lineHeight: 1.5, maxWidth: 900 }}>
            One itinerary, costed and checked, for where you are actually going.
          </div>
        </div>
        {/* A rule in the brand green, the same device the trip card uses to
            stop the composition floating in the middle of the canvas. */}
        <div style={{ display: "flex", width: 120, height: 5, background: "#2c6a4c", borderRadius: 3 }} />
      </div>
    ),
    {
      ...size,
      fonts: literata
        ? [{ name: "Literata", data: literata, weight: 600, style: "normal" }]
        : undefined,
    }
  );
}
