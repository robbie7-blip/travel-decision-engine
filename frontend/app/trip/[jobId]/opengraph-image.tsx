// Per-trip social share image. Bundles the Fraunces weight already used for
// the "decide" wordmark (frontend/lib/fonts, SIL OFL) so a shared trip link
// renders on-brand in iMessage/Slack/WhatsApp instead of a bare URL.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadJob } from "@/lib/loadJob";
import { computeTrustScore } from "@/lib/trustScore";
import { TRANSLATIONS } from "@/lib/i18n";

export const runtime = "nodejs";
export const alt = "A trip planned with decide";
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
      <stop offset="0" stop-color="#4f9aa8"/>
      <stop offset="1" stop-color="#1f6f8a"/>
    </linearGradient>
  </defs>
  <path d="M18 15 Q 34 40 50 72" fill="none" stroke="url(#l)" stroke-width="3.5" stroke-linecap="round" opacity="0.65"/>
  <path d="M82 15 Q 66 40 50 72" fill="none" stroke="url(#r)" stroke-width="3.5" stroke-linecap="round" opacity="0.65"/>
  <path d="M50 10 L 50 72" fill="none" stroke="url(#m)" stroke-width="4.5" stroke-linecap="round" opacity="0.85"/>
  <circle cx="50" cy="78" r="8" fill="#d9643f"/>
</svg>`;
const MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

const MAX_SUMMARY_LENGTH = 150;

// Same thresholds as trustScoreColor in ItineraryResult.tsx, in hex since
// this renderer (satori) doesn't resolve CSS custom properties.
function trustScoreColor(percent: number): string {
  if (percent >= 80) return "#1f6f8a"; // --grounded
  if (percent >= 50) return "#c97f1e"; // --unverified
  return "#b8452f"; // --infeasible
}

export default async function TripOgImage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await loadJob(jobId);

  // job.brief.language is already known server-side (it's how the itinerary
  // itself was generated) — no ?lang= query param needed here, unlike the
  // destinations OG images, which don't have a per-request "language" to
  // read until a query param supplies one.
  const language = job?.brief?.language === "bg" ? "bg" : "en";
  const t = TRANSLATIONS[language];

  const destinations = job?.brief?.destinations?.join(" · ") ?? t.tagline;
  const rawSummary = job?.result?.trip_summary ?? `${t.headlineLine1} ${t.headlineLine2}`;
  const summary = rawSummary.length > MAX_SUMMARY_LENGTH ? `${rawSummary.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : rawSummary;
  const feasible = job?.result?.budget_feasibility?.feasible;
  const trustScore = job?.result ? computeTrustScore(job.result) : null;

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
          <span style={{ fontSize: 28, fontWeight: 600, color: "#1f6f8a" }}>decide</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 600, color: "#2b241c", lineHeight: 1.15, maxWidth: 1000 }}>
            {destinations}
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#4a4136", lineHeight: 1.5, maxWidth: 940 }}>
            {summary}
          </div>
        </div>
        {(typeof feasible === "boolean" || (trustScore && trustScore.totalCount > 0)) && (
          <div style={{ display: "flex", alignSelf: "flex-start", gap: 16 }}>
            {typeof feasible === "boolean" && (
              <div
                style={{
                  display: "flex",
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
                {feasible ? t.result.budgetFeasible : t.result.budgetNotFeasible}
              </div>
            )}
            {trustScore && trustScore.totalCount > 0 && (
              <div
                style={{
                  display: "flex",
                  border: `3px solid ${trustScoreColor(trustScore.percent)}`,
                  color: trustScoreColor(trustScore.percent),
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 2,
                  padding: "10px 22px",
                  borderRadius: 8,
                  textTransform: "uppercase",
                }}
              >
                {trustScore.percent}% {t.result.trustScoreLabel}
              </div>
            )}
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
