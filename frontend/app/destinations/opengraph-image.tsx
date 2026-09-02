// Social share image for the /destinations index — same branding as the
// per-city guide image (see [slug]/opengraph-image.tsx) and the trip
// share image, just without a specific city's photo to feature.
//
// English-only, not a locale gap that's fixable here: Next's
// opengraph-image.tsx file convention only ever passes `params` to this
// function, never `searchParams` — confirmed by trying it (a ?lang=bg
// request still throws "Cannot destructure property 'lang' of undefined"
// inside this function, and the build's static-prerender pass also has no
// searchParams at all). See https://github.com/vercel/next.js/discussions/56314.
// A real per-locale OG image would need a custom Route Handler instead of
// this file convention, reading request.nextUrl.searchParams directly.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listDestinationSlugs } from "@/lib/destinations";
import { TRANSLATIONS } from "@/lib/i18n";

export const runtime = "nodejs";
export const alt = "decide — destination guides";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

export default async function DestinationsIndexOgImage() {
  const t = TRANSLATIONS.en.destinations;
  const count = listDestinationSlugs().length;

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img width={52} height={52} src={MARK_DATA_URI} alt="" />
          <span style={{ fontSize: 28, fontWeight: 600, color: "#2c6a4c" }}>decide</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 600, color: "#2b241c", lineHeight: 1.15 }}>
            {t.pageTitle}
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#4a4136", lineHeight: 1.5, maxWidth: 940 }}>
            {t.pageDescription.replace("{count}", String(count))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: literata ? [{ name: "Literata", data: literata, weight: 600, style: "normal" }] : undefined,
    }
  );
}
