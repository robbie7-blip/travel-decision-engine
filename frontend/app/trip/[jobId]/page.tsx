import { TripView } from "@/components/TripView";

export default async function TripPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <TripView jobId={jobId} />;
}
