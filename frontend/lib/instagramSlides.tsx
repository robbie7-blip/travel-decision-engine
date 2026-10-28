// The Instagram carousel for a blog post, drawn as images (1080x1350, the
// 4:5 portrait Instagram shows at full height in the feed). The words come
// from instagramPackage (lib/blogAutopilot.ts); this only draws them.
//
// Server-only: it reads the cover photo and the headline font from disk.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstagramSlide } from "./blogAutopilot";

export const SLIDE_SIZE = { width: 1080, height: 1350 };

const GREEN = "#1b3a2c";
const CREAM = "#f1efe4";
const AMBER = "#e8a23f";
const CORAL = "#d9643f";

async function photoDataUri(coverUrl: string | null): Promise<string | null> {
  if (!coverUrl) return null;
  try {
    if (coverUrl.startsWith("/destinations/")) {
      const bytes = await readFile(join(process.cwd(), "public", coverUrl));
      return `data:image/jpeg;base64,${bytes.toString("base64")}`;
    }
    // Pexels or Unsplash, the only other hosts a cover may come from.
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

async function literata(): Promise<Buffer | null> {
  try {
    return await readFile(join(process.cwd(), "lib/fonts/literata-600.ttf"));
  } catch {
    return null;
  }
}

/** The decide mark, as the logo draws it: two amber lines and a green one
 * meeting at a coral dot. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d="M18 15 Q 34 40 50 72" fill="none" stroke={AMBER} strokeWidth="4" strokeLinecap="round" opacity="0.75" />
      <path d="M82 15 Q 66 40 50 72" fill="none" stroke={AMBER} strokeWidth="4" strokeLinecap="round" opacity="0.75" />
      <path d="M50 10 L 50 72" fill="none" stroke="#4f9a72" strokeWidth="5" strokeLinecap="round" />
      <circle cx="50" cy="78" r="8" fill={CORAL} />
    </svg>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Mark size={52} />
      <div style={{ fontFamily: "Literata", fontSize: 40, color: CREAM }}>decide</div>
    </div>
  );
}

export async function instagramSlideImage(
  slide: InstagramSlide,
  index: number,
  total: number,
  coverUrl: string | null
): Promise<ImageResponse> {
  const font = await literata();
  const fonts = font ? [{ name: "Literata", data: font, weight: 600 as const, style: "normal" as const }] : [];
  const counter = `${index + 1} / ${total}`;

  if (slide.kind === "cover") {
    const photo = await photoDataUri(coverUrl);
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: GREEN }}>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not rendered in a page
            <img src={photo} alt="" width={1080} height={1350} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          )}
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundImage: "linear-gradient(to bottom, rgba(15,25,20,0.3) 0%, rgba(15,25,20,0) 30%, rgba(15,25,20,0.7) 55%, rgba(15,25,20,0.95) 80%, rgba(15,25,20,0.97) 100%)" }} />
          <div style={{ position: "absolute", left: 72, right: 72, bottom: 96, display: "flex", flexDirection: "column", gap: 28 }}>
            {slide.text && (
              <div style={{ fontSize: 30, letterSpacing: 6, color: AMBER, textTransform: "uppercase", fontWeight: 700 }}>{slide.text}</div>
            )}
            <div style={{ fontFamily: "Literata", fontSize: slide.title.length > 60 ? 72 : 88, lineHeight: 1.12, color: CREAM }}>{slide.title}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
              <Brand />
              <div style={{ fontSize: 28, color: CREAM, opacity: 0.8 }}>Swipe →</div>
            </div>
          </div>
        </div>
      ),
      { ...SLIDE_SIZE, fonts }
    );
  }

  if (slide.kind === "cta") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 48, background: GREEN, color: CREAM }}>
          <Mark size={260} />
          <div style={{ fontFamily: "Literata", fontSize: 84, textAlign: "center", lineHeight: 1.15, padding: "0 90px" }}>{slide.title}</div>
          <div style={{ fontSize: 34, color: AMBER, letterSpacing: 4, fontWeight: 700 }}>{slide.text.toUpperCase()}</div>
          <div style={{ fontSize: 30, opacity: 0.8, textAlign: "center", padding: "0 120px", lineHeight: 1.4 }}>
            Your whole trip, planned day by day, checked against live prices.
          </div>
        </div>
      ),
      { ...SLIDE_SIZE, fonts }
    );
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: GREEN, color: CREAM, padding: "90px 84px" }}>
        <div style={{ fontSize: 30, color: AMBER, letterSpacing: 4, fontWeight: 700 }}>{counter}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
          <div style={{ fontFamily: "Literata", fontSize: slide.title.length > 40 ? 76 : 92, lineHeight: 1.12 }}>{slide.title}</div>
          <div style={{ width: 120, height: 6, background: CORAL, borderRadius: 3 }} />
          <div style={{ fontSize: 44, lineHeight: 1.45, opacity: 0.92 }}>{slide.text}</div>
        </div>
        <Brand />
      </div>
    ),
    { ...SLIDE_SIZE, fonts }
  );
}
