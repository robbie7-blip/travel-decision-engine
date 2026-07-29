// Companion to lodgingCache.ts for the other kind of search-verified fact: a
// specific named restaurant/activity venue's price. Restaurants/activities
// only ever get a single verification search (see SEARCH_INSTRUCTIONS in
// index.ts), so a cached venue is always "single_source" tier — the
// two-search "verified" tier is lodging's cross-check alone.
//
// Unlike lodging, which is asked about the same way regardless of the
// specific traveler (safe to unconditionally tell the model "reuse this"),
// a restaurant/activity pick depends on that traveler's dietary/interest/
// mobility constraints — so cached venues are offered as candidates the
// model may reuse if they fit, not a forced substitution. Also unlike
// lodging (one price per city, keyed by destination alone), a venue is
// keyed by destination + venue name, since there's no single "the
// restaurant" for a city the way there's one representative lodging price
// range — so an index set per city tracks which venue keys currently exist.

import type Redis from "ioredis";
import type { Itinerary, TripBriefInput } from "./types";

const CACHE_TTL_SECONDS = 20 * 60 * 60; // same window as lodgingCache.ts
const MAX_VENUES_PER_CITY = 6; // keeps the prompt injection bounded

interface CachedVenue {
  title: string;
  type: "meal" | "activity";
  costEstimateEur: number;
  sourceUrls: string[];
  cachedAt: number;
}

function citySlug(city: string): string {
  return city.toLowerCase().replace(/ /g, "_");
}

function venueSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function indexKey(city: string): string {
  return `venue-cache-index:${citySlug(city)}`;
}

function venueKey(city: string, slug: string): string {
  return `venue-cache:${citySlug(city)}:${slug}`;
}

function matchDestination(location: string, destinations: string[]): string | undefined {
  const loc = location.toLowerCase();
  return destinations.find((d) => loc.includes(d.toLowerCase()));
}

function formatCachedVenues(city: string, venues: CachedVenue[]): string {
  const lines = venues.map((v) => {
    const hoursAgo = Math.max(1, Math.round((Date.now() - v.cachedAt) / 3_600_000));
    const urlsText = v.sourceUrls.length ? v.sourceUrls.join(", ") : "(no URL recorded)";
    return `- "${v.title}" (${v.type}): approx €${v.costEstimateEur}, source_urls: [${urlsText}], verified ${hoursAgo}h ago`;
  });
  return (
    `Previously verified restaurants/activities for ${city} (each already confirmed real and ` +
    `priced via live search recently):\n${lines.join("\n")}\n` +
    `If any of these fit the traveler's dietary/interest/mobility constraints, prefer reusing one ` +
    `instead of searching for a new venue: copy its exact cost_estimate_eur and source_urls, set ` +
    `source_confidence to "grounded", and do not search for it again. If none fit, choose a ` +
    `different venue and search for it as usual.`
  );
}

/** Returns a map of destination -> ready-to-inject prompt text, for
 * destinations with at least one non-expired cached venue. */
export async function loadCachedVenueFacts(redis: Redis, destinations: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  await Promise.all(
    destinations.map(async (city) => {
      const idxKey = indexKey(city);
      const slugs = await redis.smembers(idxKey);
      if (!slugs.length) return;

      const raws = await Promise.all(slugs.map((slug) => redis.get(venueKey(city, slug))));
      const venues: CachedVenue[] = [];
      const staleSlugs: string[] = [];
      slugs.forEach((slug, i) => {
        const raw = raws[i];
        if (!raw) {
          staleSlugs.push(slug);
          return;
        }
        try {
          venues.push(JSON.parse(raw) as CachedVenue);
        } catch {
          staleSlugs.push(slug);
        }
      });
      // Best-effort tidy-up: a venue key can expire (TTL) while its slug
      // lingers in the index set, since set membership has no per-member
      // expiry — drop those so the set doesn't grow stale over time.
      if (staleSlugs.length) {
        await redis.srem(idxKey, ...staleSlugs).catch(() => {});
      }
      if (!venues.length) return;

      venues.sort((a, b) => b.cachedAt - a.cachedAt);
      result[city] = formatCachedVenues(city, venues.slice(0, MAX_VENUES_PER_CITY));
    })
  );
  return result;
}

/** Best-effort: scans a finished itinerary for search-verified named-venue
 * meal/activity items and caches each one under its destination. Never
 * throws — caching must not affect the actual response. */
export async function cacheVenueFacts(redis: Redis, brief: TripBriefInput, itinerary: Itinerary): Promise<void> {
  try {
    for (const day of itinerary.days ?? []) {
      for (const item of day.items) {
        if (item.type !== "meal" && item.type !== "activity") continue;
        if (item.confidence_tier !== "single_source") continue;
        const dest = matchDestination(item.location, brief.destinations);
        if (!dest) continue;
        const slug = venueSlug(item.title);
        if (!slug) continue;
        const venue: CachedVenue = {
          title: item.title,
          type: item.type,
          costEstimateEur: item.cost_estimate_eur,
          sourceUrls: item.source_urls ?? [],
          cachedAt: Date.now(),
        };
        await redis.set(venueKey(dest, slug), JSON.stringify(venue), "EX", CACHE_TTL_SECONDS);
        await redis.sadd(indexKey(dest), slug);
        await redis.expire(indexKey(dest), CACHE_TTL_SECONDS);
      }
    }
  } catch (e) {
    console.error("[worker] failed to cache venue facts:", e);
  }
}
