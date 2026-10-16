import type { Metadata } from "next";
import { DestinationsIndex, destinationsIndexMetadata } from "@/components/destinations/DestinationsIndex";

// The Bulgarian guides index, at its own address.

export const metadata: Metadata = destinationsIndexMetadata("bg");

export default function BulgarianDestinationsIndexPage() {
  return <DestinationsIndex language="bg" />;
}
