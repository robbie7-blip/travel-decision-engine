import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { DestinationsIndex, destinationsIndexMetadata } from "@/components/destinations/DestinationsIndex";
import { destinationsPath } from "@/lib/destinationPaths";

// The English guides index. Bulgarian: app/bg/destinations, where the old
// ?lang=bg address redirects.

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { lang } = await searchParams;
  return destinationsIndexMetadata(lang === "bg" ? "bg" : "en");
}

export default async function DestinationsIndexPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  if (lang === "bg") permanentRedirect(destinationsPath("bg"));
  return <DestinationsIndex language="en" />;
}
