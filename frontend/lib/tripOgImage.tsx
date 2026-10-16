// The share card for a trip (/trip/<id>) and a published trip (/plans/<slug>):
// what Messenger, WhatsApp, Facebook and iMessage show when the link is
// pasted. The trip's title and summary on the left, a photograph of its
// first city on the right - the city is what makes someone tap.
//
// Server-only: it reads the photo and the font from disk.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { coverPhotoFor } from "./tripCover";

export const OG_SIZE = { width: 1200, height: 630 };

const MARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M18 15 Q 34 40 50 72" fill="none" stroke="#c9a46a" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M82 15 Q 66 40 50 72" fill="none" stroke="#c9a46a" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M50 10 L 50 72" fill="none" stroke="#2c6a4c" stroke-width="4.5" stroke-linecap="round"/>
  <circle cx="50" cy="78" r="8" fill="#d9643f"/>
</svg>`;
const MARK = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

export interface TripOgInput {
  destinations: string[];
  /** "3 days in Rome and Florence" - or just the cities when there is no
   * plan to count. */
  title: string;
  summary: string;
  /** Small stamps under the summary, e.g. "Within budget", "84% checked". */
  stamps?: { text: string; color: string }[];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

async function photoDataUri(destinations: string[]): Promise<string | null> {
  const photo = coverPhotoFor(destinations);
  if (!photo) return null;
  try {
    const bytes = await readFile(join(process.cwd(), "public", photo.src));
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function tripOgImage(input: TripOgInput): Promise<ImageResponse> {
  const [photo, font] = await Promise.all([
    photoDataUri(input.destinations),
    readFile(join(process.cwd(), "lib/fonts/literata-600.ttf")).catch(() => null),
  ]);
  const textWidth = photo ? 640 : 1056;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f7f1e2", fontFamily: font ? "Literata" : undefined }}>
        <div style={{ display: "flex", flexDirection: "column", width: photo ? 700 : 1200, padding: "56px 60px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders <img>, not next/image */}
            <img width={46} height={46} src={MARK} alt="" />
            <span style={{ fontSize: 28, fontWeight: 600, color: "#2c6a4c" }}>decide</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 20, maxWidth: textWidth }}>
            <div style={{ display: "flex", fontSize: 54, fontWeight: 600, color: "#2b241c", lineHeight: 1.12 }}>
              {clip(input.title, 60)}
            </div>
            {input.summary && (
              <div style={{ display: "flex", fontSize: 25, color: "#4a4136", lineHeight: 1.45 }}>{clip(input.summary, 140)}</div>
            )}
          </div>
          {input.stamps && input.stamps.length > 0 && (
            <div style={{ display: "flex", gap: 12 }}>
              {input.stamps.map((s) => (
                <div
                  key={s.text}
                  style={{
                    display: "flex",
                    border: `3px solid ${s.color}`,
                    color: s.color,
                    fontSize: 19,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    padding: "8px 16px",
                    borderRadius: 8,
                    textTransform: "uppercase",
                  }}
                >
                  {s.text}
                </div>
              ))}
            </div>
          )}
        </div>
        {photo && (
          <div style={{ display: "flex", width: 500, height: 630 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders <img>, not next/image */}
            <img src={photo} width={500} height={630} alt="" style={{ objectFit: "cover", width: 500, height: 630 }} />
          </div>
        )}
      </div>
    ),
    { ...OG_SIZE, fonts: font ? [{ name: "Literata", data: font, weight: 600, style: "normal" }] : undefined }
  );
}

/** The card as a JPEG, which is what makes it show at all on WhatsApp:
 * WhatsApp drops preview images over about 300kB, and with a photograph in
 * it the PNG ImageResponse produces is twice that. sharp is the encoder
 * Next itself uses for images; if it is ever missing, the PNG is served
 * rather than nothing. */
export async function tripOgJpeg(input: TripOgInput): Promise<Response> {
  const png = Buffer.from(await (await tripOgImage(input)).arrayBuffer());
  const headers = { "Cache-Control": "public, max-age=3600, s-maxage=86400" };
  try {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(png).jpeg({ quality: 80, progressive: true, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch {
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  }
}
