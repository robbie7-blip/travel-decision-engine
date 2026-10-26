// Per-city social share image for the destination guides. The drawing
// is lib/destinationOgImage.tsx, shared by both languages.

import { DESTINATION_OG_SIZE, safeDestinationOgImage } from "@/lib/destinationOgImage";

export const runtime = "nodejs";
export const alt = "A decide destination guide";
export const size = DESTINATION_OG_SIZE;
export const contentType = "image/jpeg";

export default async function DestinationOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return safeDestinationOgImage(slug, "en");
}
