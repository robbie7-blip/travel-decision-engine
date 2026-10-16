import type { Metadata } from "next";
import { DestinationGuide, destinationGuideMetadata } from "@/components/destinations/DestinationGuide";
import { listDestinationSlugs } from "@/lib/destinations";

// The Bulgarian destination guide, at its own address. Same page as the
// English one (components/destinations/DestinationGuide.tsx), in Bulgarian.

export function generateStaticParams() {
  return listDestinationSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return destinationGuideMetadata(slug, "bg");
}

export default async function BulgarianDestinationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DestinationGuide slug={slug} language="bg" />;
}
