// Social share image for the /destinations index — same branding as the
// per-city guide image (see [slug]/opengraph-image.tsx) and the trip
// share image, just without a specific city's photo to feature.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listDestinationSlugs } from "@/lib/destinations";

export const runtime = "nodejs";
export const alt = "decide — destination guides";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="50" y1="45" x2="50" y2="86" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4f9aa8"/>
      <stop offset="1" stop-color="#1f6f8a"/>
    </linearGradient>
    <linearGradient id="l" x1="22" y1="18" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e8a23f"/>
      <stop offset="1" stop-color="#8a7d68"/>
    </linearGradient>
    <linearGradient id="m" x1="50" y1="12" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e8a23f"/>
      <stop offset="1" stop-color="#8a7d68"/>
    </linearGradient>
    <linearGradient id="r" x1="78" y1="18" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e8a23f"/>
      <stop offset="1" stop-color="#8a7d68"/>
    </linearGradient>
  </defs>
  <path d="M22 18 Q 36 34 50 50" fill="none" stroke="url(#l)" stroke-width="3.5" stroke-linecap="round" opacity="0.6"/>
  <path d="M50 12 L 50 50" fill="none" stroke="url(#m)" stroke-width="3.5" stroke-linecap="round" opacity="0.6"/>
  <path d="M78 18 Q 64 34 50 50" fill="none" stroke="url(#r)" stroke-width="3.5" stroke-linecap="round" opacity="0.6"/>
  <path d="M50 50 L 50 78" fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round"/>
  <circle cx="50" cy="84" r="9" fill="#d9643f"/>
</svg>`;
const MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

export default async function DestinationsIndexOgImage() {
  const count = listDestinationSlugs().length;

  let fraunces: Buffer | null = null;
  try {
    fraunces = await readFile(join(process.cwd(), "lib/fonts/fraunces-600.ttf"));
  } catch {
    fraunces = null;
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
          fontFamily: fraunces ? "Fraunces" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img width={52} height={52} src={MARK_DATA_URI} alt="" />
          <span style={{ fontSize: 28, fontWeight: 600, color: "#3f7a4a" }}>decide</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 600, color: "#2b241c", lineHeight: 1.15 }}>
            Destination guides
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#4a4136", lineHeight: 1.5, maxWidth: 940 }}>
            What decide already knows about {count} cities before it even runs a live search.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fraunces ? [{ name: "Fraunces", data: fraunces, weight: 600, style: "normal" }] : undefined,
    }
  );
}
