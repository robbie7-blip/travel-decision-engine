// Per-trip social share image. Bundles the Fraunces weight already used for
// the "decide" wordmark (frontend/lib/fonts, SIL OFL) so a shared trip link
// renders on-brand in iMessage/Slack/WhatsApp instead of a bare URL.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadJob } from "@/lib/loadJob";

export const runtime = "nodejs";
export const alt = "A trip planned with decide";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="50" y1="45" x2="50" y2="86" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5fc9d9"/>
      <stop offset="1" stop-color="#1f6f8a"/>
    </linearGradient>
  </defs>
  <path d="M22 18 Q 36 34 50 50" fill="none" stroke="#8a7d68" stroke-width="3.5" stroke-linecap="round" opacity="0.45"/>
  <path d="M50 12 L 50 50" fill="none" stroke="#8a7d68" stroke-width="3.5" stroke-linecap="round" opacity="0.45"/>
  <path d="M78 18 Q 64 34 50 50" fill="none" stroke="#8a7d68" stroke-width="3.5" stroke-linecap="round" opacity="0.45"/>
  <path d="M50 50 L 50 78" fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round"/>
  <circle cx="50" cy="84" r="7" fill="#d9643f"/>
</svg>`;
const MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

const MAX_SUMMARY_LENGTH = 150;

export default async function TripOgImage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await loadJob(jobId);

  const destinations = job?.brief?.destinations?.join(" · ") ?? "A trip, decided";
  const rawSummary = job?.result?.trip_summary ?? "It doesn't list options. It decides for you.";
  const summary = rawSummary.length > MAX_SUMMARY_LENGTH ? `${rawSummary.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : rawSummary;
  const feasible = job?.result?.budget_feasibility?.feasible;

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
          <span style={{ fontSize: 28, fontWeight: 600, color: "#2b241c" }}>decide</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 600, color: "#2b241c", lineHeight: 1.15, maxWidth: 1000 }}>
            {destinations}
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#4a4136", lineHeight: 1.5, maxWidth: 940 }}>
            {summary}
          </div>
        </div>
        {typeof feasible === "boolean" && (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              border: `3px solid ${feasible ? "#1f6f8a" : "#b8452f"}`,
              color: feasible ? "#1f6f8a" : "#b8452f",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 2,
              padding: "10px 22px",
              borderRadius: 8,
              textTransform: "uppercase",
            }}
          >
            {feasible ? "Budget: feasible" : "Budget: not feasible"}
          </div>
        )}
      </div>
    ),
    {
      ...size,
      fonts: fraunces ? [{ name: "Fraunces", data: fraunces, weight: 600, style: "normal" }] : undefined,
    }
  );
}
