import type { Metadata } from "next";
import { TripView } from "@/components/TripView";
import { loadJob } from "@/lib/loadJob";
import { citiesInPlan } from "@/lib/tripCities";
import { latestRevision } from "@/lib/latestRevision";
import { getRedis } from "@/lib/redis";
import { getDb } from "@/lib/db";
import { newestVersionOf } from "@/lib/tripsQuery";
import { redirect } from "next/navigation";

const MAX_DESCRIPTION_LENGTH = 160;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const { jobId } = await params;
  const job = await loadJob(jobId);

  // Not found, still generating, or failed - fall back to the root layout's
  // generic site metadata rather than describing a trip that isn't there.
  if (!job || job.status !== "done" || !job.result) return {};

  // The plan's cities, not the brief's: see lib/tripCities.
  const title = `${(citiesInPlan(job.brief.destinations, job.result.days) ?? []).join(" · ")} - decide`;
  const summary = job.result.trip_summary;
  const description =
    summary.length > MAX_DESCRIPTION_LENGTH ? `${summary.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : summary;

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { jobId } = await params;
  const query = await searchParams;
  // A link shared before the owner pushed back or edited the trip opens
  // the newest version (lib/latestRevision). ?version=this keeps the one
  // asked for, for anyone who wants to compare. Redis being unreachable
  // just shows the link as it is.
  if (query.version !== "this") {
    let latest = jobId;
    try {
      latest = await latestRevision(getRedis(), jobId);
    } catch {
      latest = jobId;
    }
    // Revisions made before the pointer existed are in the archive.
    const db = getDb();
    if (db) {
      try {
        latest = await newestVersionOf(db, latest);
      } catch {
        // The archive being down just leaves the link where Redis put it.
      }
    }
    if (latest !== jobId) {
      const rest = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (typeof value === "string") rest.set(key, value);
      }
      const suffix = rest.toString();
      redirect(`/trip/${encodeURIComponent(latest)}${suffix ? `?${suffix}` : ""}`);
    }
  }
  return <TripView jobId={jobId} />;
}
