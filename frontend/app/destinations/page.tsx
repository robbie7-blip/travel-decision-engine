import type { Metadata } from "next";
import { DestinationsIndex, destinationsIndexMetadata } from "@/components/destinations/DestinationsIndex";

// The English guides index. Bulgarian: app/bg/destinations; the old
// ?lang=bg address redirects there (next.config).

export const metadata: Metadata = destinationsIndexMetadata("en");

export default function DestinationsIndexPage() {
  return <DestinationsIndex language="en" />;
}
