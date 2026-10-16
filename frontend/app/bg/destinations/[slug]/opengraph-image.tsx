// Per-city social share image for the Bulgarian destination guides. The drawing
// is lib/destinationOgImage.tsx, shared by both languages.

import { destinationOgImage, DESTINATION_OG_SIZE } from "@/lib/destinationOgImage";
import { asJpeg } from "@/lib/tripOgImage";

export const runtime = "nodejs";
export const alt = "Пътеводител на decide";
export const size = DESTINATION_OG_SIZE;
export const contentType = "image/jpeg";

export default async function DestinationOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return asJpeg(await destinationOgImage(slug, "bg"));
}
