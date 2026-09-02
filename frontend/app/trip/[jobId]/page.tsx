import type { Metadata } from "next";
import { TripView } from "@/components/TripView";
import { loadJob } from "@/lib/loadJob";

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

  const title = `${job.brief.destinations.join(" · ")} - decide`;
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

export default async function TripPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <TripView jobId={jobId} />;
}
