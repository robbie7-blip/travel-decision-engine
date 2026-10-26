// The share card for a trip link - see lib/tripOgImage.tsx.

import { citiesInPlan } from "@/lib/tripCities";
import { loadJob } from "@/lib/loadJob";
import { computeTrustScore } from "@/lib/trustScore";
import { TRANSLATIONS } from "@/lib/i18n";
import { publishedTitle } from "@/lib/tripsQuery";
import { OG_SIZE, tripOgJpeg } from "@/lib/tripOgImage";

export const runtime = "nodejs";
export const alt = "A trip planned with decide";
export const size = OG_SIZE;
export const contentType = "image/jpeg";

function trustColor(percent: number): string {
  if (percent >= 80) return "#2c6a4c";
  if (percent >= 50) return "#a5651a";
  return "#b8452f";
}

export default async function TripOgImage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await loadJob(jobId);
  const language = job?.brief?.language === "bg" ? "bg" : "en";
  const t = TRANSLATIONS[language];
  // The plan's cities, not the brief's: see lib/tripCities.
  const destinations =
    citiesInPlan((job?.brief?.destinations ?? []).filter((d): d is string => typeof d === "string"), job?.result?.days) ?? [];
  const days = job?.result?.days?.length ?? 0;

  const stamps: { text: string; color: string }[] = [];
  const feasible = job?.result?.budget_feasibility?.feasible;
  if (typeof feasible === "boolean") {
    stamps.push({ text: feasible ? t.result.budgetFeasible : t.result.budgetNotFeasible, color: feasible ? "#2c6a4c" : "#b8452f" });
  }
  const trust = job?.result ? computeTrustScore(job.result) : null;
  if (trust && trust.totalCount > 0) stamps.push({ text: `${trust.percent}% ${t.result.trustScoreLabel}`, color: trustColor(trust.percent) });

  return tripOgJpeg({
    destinations,
    title: destinations.length && days ? publishedTitle(destinations, days, language) : destinations.join(" · ") || t.tagline,
    summary: typeof job?.result?.trip_summary === "string" ? job.result.trip_summary : `${t.headlineLine1} ${t.headlineLine2}`,
    stamps,
  });
}
