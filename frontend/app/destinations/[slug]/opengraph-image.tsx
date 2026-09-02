// Per-city social share image for the /destinations guides - without this,
// sharing a guide link fell back to the site's generic OG metadata (no
// photo, no city name), even for cities that now have a real photo. Mirrors
// the pattern and branding of trip/[jobId]/opengraph-image.tsx: same
// bundled Literata weight, same mark, same 1200x630 size.
//
// English-only, not a locale gap that's fixable here: Next's
// opengraph-image.tsx file convention only ever passes `params` to this
// function, never `searchParams` - confirmed by trying it (a ?lang=bg
// request still throws "Cannot destructure property 'lang' of undefined"
// inside this function). See https://github.com/vercel/next.js/discussions/56314.
// A real per-locale OG image would need a custom Route Handler instead of
// this file convention, reading request.nextUrl.searchParams directly.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDestinationPhoto, getLocalizedCityName, loadDestination } from "@/lib/destinations";
import { DESTINATION_INTROS } from "@/lib/destinationIntros";
import { TRANSLATIONS } from "@/lib/i18n";

export const runtime = "nodejs";
export const alt = "A decide destination guide";
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

// Same palette + hash as DestinationBanner.tsx, for cities without a real
// photo yet - keeps the fallback share image on-brand rather than blank.
const PALETTES: [string, string][] = [
  ["#1b3a2c", "#4f9a72"],
  ["#d9643f", "#e8a23f"],
  ["#2b241c", "#4a4136"],
  ["#7d5ba6", "#4f9a72"],
  ["#e8a23f", "#d9643f"],
  ["#2c6a4c", "#7d5ba6"],
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

/** Truncates at the last whole word within the limit rather than mid-word -
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
  const t = TRANSLATIONS.en.destinations;
  const destination = loadDestination(slug);
  const city = destination ? getLocalizedCityName(slug, "en", destination.city) : slug;
  const rawIntro = DESTINATION_INTROS.en[slug] ?? t.introDisclaimer.replace("{city}", city);
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
          position: "relative",
          background: photoDataUri ? "#2b241c" : `linear-gradient(135deg, ${from}, ${to})`,
          fontFamily: literata ? "Literata" : undefined,
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
              {t.eyebrow}
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
      fonts: literata ? [{ name: "Literata", data: literata, weight: 600, style: "normal" }] : undefined,
    }
  );
}
