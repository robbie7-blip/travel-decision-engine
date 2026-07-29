// Read-only accessor for the curated facts/*.json files, used by the public
// /destinations guide pages. Deliberately separate from
// lib/engine/prompt.ts's loadFacts (which only needs category+text for the
// model prompt) since these pages also need the display name and the full
// list of available slugs, and this file must NOT be mirrored to the
// worker — it's Next.js/fs-at-build-time only.

import fs from "node:fs";
import path from "node:path";

const FACTS_DIR = path.join(process.cwd(), "facts");

export interface DestinationFact {
  category: string;
  text: string;
}

export interface Destination {
  slug: string;
  city: string;
  facts: DestinationFact[];
}

export function listDestinationSlugs(): string[] {
  if (!fs.existsSync(FACTS_DIR)) return [];
  return fs
    .readdirSync(FACTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadDestination(slug: string): Destination | null {
  const filePath = path.join(FACTS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { slug, city: data.city ?? slug, facts: data.facts ?? [] };
  } catch {
    return null;
  }
}

export function listDestinations(): Destination[] {
  return listDestinationSlugs()
    .map(loadDestination)
    .filter((d): d is Destination => d !== null);
}
