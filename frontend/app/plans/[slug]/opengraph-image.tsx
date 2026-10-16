// The share card for a published trip - see lib/tripOgImage.tsx.

import { getDb } from "@/lib/db";
import { getPublished } from "@/lib/tripsQuery";
import { OG_SIZE, tripOgJpeg } from "@/lib/tripOgImage";

export const runtime = "nodejs";
export const alt = "A trip planned with decide";
export const size = OG_SIZE;
export const contentType = "image/jpeg";

export default async function PublishedTripOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const trip = db ? await getPublished(db, slug).catch(() => null) : null;
  return tripOgJpeg({
    destinations: trip?.destinations ?? [],
    title: trip?.title ?? "decide",
    summary: trip?.summary ?? "",
  });
}
