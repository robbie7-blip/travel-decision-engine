// Per-city social share image for the /destinations guides — without this,
// sharing a guide link fell back to the site's generic OG metadata (no
// photo, no city name), even for cities that now have a real photo. Mirrors
// the pattern and branding of trip/[jobId]/opengraph-image.tsx: same
// bundled Fraunces weight, same mark, same 1200x630 size.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDestinationPhoto, getLocalizedCityName, loadDestination } from "@/lib/destinations";
import { DESTINATION_INTROS } from "@/lib/destinationIntros";

export const runtime = "nodejs";
export const alt = "A decide destination guide";
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

// Same palette + hash as DestinationBanner.tsx, for cities without a real
// photo yet — keeps the fallback share image on-brand rather than blank.
const PALETTES: [string, string][] = [
  ["#1f6f8a", "#5fc9d9"],
  ["#d9643f", "#e8a23f"],
  ["#2b241c", "#4a4136"],
  ["#7d5ba6", "#5fc9d9"],
  ["#e8a23f", "#d9643f"],
  ["#1f6f8a", "#7d5ba6"],
];

function paletteFor(slug: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const MAX_INTRO_LENGTH = 110;

/** Truncates at the last whole word within the limit rather than mid-word —
 * slicing at a fixed character count landed inside a word often enough
 * (e.g. "...precise enough t…") to be worth the extra step. */
function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export default async function DestinationOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const destination = loadDestination(slug);
  const city = destination ? getLocalizedCityName(slug, "en", destination.city) : slug;
  const rawIntro = DESTINATION_INTROS.en[slug] ?? "What decide already knows before it even runs a live search.";
  const intro = truncateAtWord(rawIntro, MAX_INTRO_LENGTH);

  const photo = getDestinationPhoto(slug);
  let photoDataUri: string | null = null;
  if (photo) {
    try {
      const ext = photo.src.slice(photo.src.lastIndexOf("."));
      const bytes = await readFile(join(process.cwd(), "public", photo.src));
      photoDataUri = `data:${MIME_BY_EXT[ext] ?? "image/jpeg"};base64,${bytes.toString("base64")}`;
    } catch {
      photoDataUri = null;
    }
  }
  const [from, to] = paletteFor(slug);

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
          position: "relative",
          background: photoDataUri ? "#2b241c" : `linear-gradient(135deg, ${from}, ${to})`,
          fontFamily: fraunces ? "Fraunces" : undefined,
        }}
      >
        {photoDataUri && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoDataUri}
            alt=""
            width={1200}
            height={630}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(20,16,10,0.55) 0%, rgba(20,16,10,0.15) 40%, rgba(20,16,10,0.75) 100%)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            padding: "56px 72px 64px",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img width={44} height={44} src={MARK_DATA_URI} alt="" />
            <span style={{ fontSize: 24, fontWeight: 600, color: "#fffdf8" }}>decide</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "flex-end", gap: 14 }}>
            <div
              style={{
                display: "flex",
                fontSize: 15,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: "rgba(255,253,248,0.8)",
              }}
            >
              DESTINATION GUIDE
            </div>
            <div style={{ display: "flex", fontSize: 68, fontWeight: 600, color: "#fffdf8", lineHeight: 1.1 }}>{city}</div>
            <div style={{ display: "flex", fontSize: 24, color: "rgba(255,253,248,0.88)", lineHeight: 1.4, maxWidth: 980 }}>
              {intro}
            </div>
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
