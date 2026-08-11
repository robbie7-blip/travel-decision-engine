// Lightweight cache for lodging prices already verified via live search.
// Lodging is asked about the same way regardless of a specific traveler's
// dates/budget/interests, and prices don't meaningfully shift hour to hour,
// so reusing a recent verified lookup skips real search round-trips (the
// actual bottleneck in generation wall-time — see SEARCH_INSTRUCTIONS in
// index.ts) without weakening verification: only genuinely search-backed
// results ("verified" or "single_source" tier) ever get cached, never
// inferred guesses.

import type Redis from "ioredis";
import type { Itinerary, TripBriefInput } from "./types";

const CACHE_TTL_SECONDS = 20 * 60 * 60; // ~20h — long enough to help back-to-back testers/users on the same city, short enough that a real price swing doesn't linger

interface CachedLodgingFact {
  costEstimateEur: number;
  sourceUrls: string[];
  sourceAgreement: "agree" | "disagree" | null;
  cachedAt: number;
}

function cacheKey(city: string): string {
  return `lodging-cache:${city.toLowerCase().replace(/ /g, "_")}`;
}

function matchDestination(location: string, destinations: string[]): string | undefined {
  const loc = location.toLowerCase();
  return destinations.find((d) => loc.includes(d.toLowerCase()));
}

function formatCachedFact(city: string, fact: CachedLodgingFact): string {
  const hoursAgo = Math.max(1, Math.round((Date.now() - fact.cachedAt) / 3_600_000));
  const urlsText = fact.sourceUrls.length ? fact.sourceUrls.join(", ") : "(no URL recorded)";
  return (
    `Lodging for ${city} was already verified via live search ${hoursAgo}h ago — reuse this instead of ` +
    `searching lodging again for ${city}: approx €${fact.costEstimateEur}/night, source_urls: [${urlsText}], ` +
    `source_agreement: ${fact.sourceAgreement ?? "null"}. Copy these exact source_urls/source_agreement values ` +
    `into your lodging item(s) for ${city}, set source_confidence to "grounded", and do not perform a new ` +
    `lodging search for this destination.`
  );
}

/** Returns a map of destination -> ready-to-inject prompt text, for
 * destinations that have a non-expired cached lodging lookup. */
export async function loadCachedLodgingFacts(
  redis: Redis,
  destinations: string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    destinations.map(async (city) => {
      const raw = await redis.get(cacheKey(city));
      if (!raw) return null;
      try {
        const fact = JSON.parse(raw) as CachedLodgingFact;
        return [city, formatCachedFact(city, fact)] as const;
      } catch {
        return null;
      }
    })
  );
  const result: Record<string, string> = {};
  for (const entry of entries) {
    if (entry) result[entry[0]] = entry[1];
  }
  return result;
}

/** Shared write path — both the post-hoc extraction below and the
 * standalone prefetch (see prefetchLodging in index.ts) land here, so
 * there's exactly one place that decides the cache entry's shape/TTL. */
export async function writeCachedLodgingFact(
  redis: Redis,
  city: string,
  fact: Omit<CachedLodgingFact, "cachedAt">
): Promise<void> {
  const entry: CachedLodgingFact = { ...fact, cachedAt: Date.now() };
  await redis.set(cacheKey(city), JSON.stringify(entry), "EX", CACHE_TTL_SECONDS);
}

/** Best-effort: scans a finished itinerary for search-verified lodging
 * items and caches one per matched destination. Never throws — caching
 * must not affect the actual response. Mostly a fallback/backstop now that
 * prefetchLodging (index.ts) populates the cache upfront for anything
 * missing before generation even starts — this still catches whatever
 * that path didn't (e.g. testMode jobs, which skip prefetch entirely). */
export async function cacheLodgingFacts(redis: Redis, brief: TripBriefInput, itinerary: Itinerary): Promise<void> {
  try {
    const seen = new Set<string>();
    for (const day of itinerary.days ?? []) {
      for (const item of day.items) {
        if (item.type !== "lodging") continue;
        if (item.confidence_tier !== "verified" && item.confidence_tier !== "single_source") continue;
        const dest = matchDestination(item.location, brief.destinations);
        if (!dest || seen.has(dest)) continue;
        seen.add(dest);
        await writeCachedLodgingFact(redis, dest, {
          costEstimateEur: item.cost_estimate_eur,
          sourceUrls: item.source_urls ?? [],
          sourceAgreement: item.source_agreement ?? null,
        });
      }
    }
  } catch (e) {
    console.error("[worker] failed to cache lodging facts:", e);
  }
}
