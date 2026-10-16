import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { DestinationGuide, destinationGuideMetadata } from "@/components/destinations/DestinationGuide";
import { listDestinationSlugs } from "@/lib/destinations";
import { destinationsPath } from "@/lib/destinationPaths";

// The English guide. The Bulgarian one is app/bg/destinations/[slug]; the
// old ?lang=bg address here redirects there, permanently, so links and
// search results that still carry it land on the page that replaced it.

export function generateStaticParams() {
  return listDestinationSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { lang } = await searchParams;
  return destinationGuideMetadata(slug, lang === "bg" ? "bg" : "en");
}

export default async function DestinationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const { lang } = await searchParams;
  if (lang === "bg") permanentRedirect(destinationsPath("bg", slug));
  return <DestinationGuide slug={slug} language="en" />;
}
