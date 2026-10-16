import type { Metadata } from "next";
import { DestinationGuide, destinationGuideMetadata } from "@/components/destinations/DestinationGuide";
import { listDestinationSlugs } from "@/lib/destinations";

// The English guide. The Bulgarian one is app/bg/destinations/[slug]; the
// old ?lang=bg address here redirects there (next.config), so this page
// reads no query string and is built once, statically.

export function generateStaticParams() {
  return listDestinationSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return destinationGuideMetadata(slug, "en");
}

export default async function DestinationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DestinationGuide slug={slug} language="en" />;
}
