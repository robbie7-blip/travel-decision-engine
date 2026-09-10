// Lightweight cache for lodging prices already verified via live search.
// Lodging is asked about the same way regardless of a specific traveler's
// dates/budget/interests, and prices don't meaningfully shift hour to hour,
// so reusing a recent verified lookup skips real search round-trips (the
// actual bottleneck in generation wall-time - see SEARCH_INSTRUCTIONS in
// index.ts) without weakening verification: only genuinely search-backed
// results ("verified" or "single_source" tier) ever get cached, never
// inferred guesses.

import type Redis from "ioredis";
import type { Itinerary, TripBriefInput } from "./types";

const CACHE_TTL_SECONDS = 20 * 60 * 60; // ~20h - long enough to help back-to-back testers/users on the same city, short enough that a real price swing doesn't linger

export interface CachedLodgingFact {
  costEstimateEur: number;
  sourceUrls: string[];
  sourceAgreement: "agree" | "disagree" | null;
  cachedAt: number;
  // The actual property the price belongs to, when the lookup found one.
  // Optional on purpose: entries written before accommodation was named
  // are still in Redis under the same key with a ~20h TTL, and an old
  // entry should keep working as an unnamed city rate rather than blowing
  // up or being thrown away.
  name?: string;
  area?: string;
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

  // Named entries let the itinerary point at a real, checkable property
  // instead of "a mid-range hotel". Unnamed ones (pre-existing cache
  // entries, or a lookup that found a rate but no specific place) keep the
  // original generic wording - better a generic accommodation item than a
  // property name we can't stand behind.
  const property = fact.name
    ? `Accommodation for ${city}: stay at ${fact.name}${fact.area ? ` in ${fact.area}` : ""} - a real, ` +
      `specific property found via live search ${hoursAgo}h ago, at approx €${fact.costEstimateEur}/night. ` +
      `Use this exact property name for ${city}'s accommodation; do not substitute a different place or a ` +
      `generic "a mid-range hotel".`
    : `Accommodation for ${city}: no specific property was found, but the typical mid-range rate was verified ` +
      `via live search ${hoursAgo}h ago at approx €${fact.costEstimateEur}/night. Leave the accommodation ` +
      `unnamed for this city and describe it generically.`;

  return (
    `${property} source_urls: [${urlsText}], source_agreement: ${fact.sourceAgreement ?? "null"}. Copy these ` +
    `exact source_urls/source_agreement values into your accommodation item(s) for ${city}, set ` +
    `source_confidence to "grounded", and do not perform a new accommodation search for this destination.`
  );
}

/** The structured cache entries behind loadCachedLodgingFacts.
 *
 * The formatted-string version is what the prompt needs; this is what the
 * PIPELINE needs. A cache hit means the price and the property are already
 * known without any model call at all - so accommodation can be built from
 * it directly, which lets the day calls start the moment the plan lands
 * instead of waiting on the trip frame to restate figures we already hold.
 *
 * Without this, a cache hit was quietly the SLOWEST path: it skipped the
 * lodging search (good) but then had nothing to build accommodation from,
 * so phase 2 fell back to waiting for the frame - putting the heavier half
 * of phase 1 back on the critical path precisely when everything else had
 * gone faster. */
export async function loadCachedLodgingEntries(
  redis: Redis,
  destinations: string[]
): Promise<Map<string, CachedLodgingFact>> {
  const out = new Map<string, CachedLodgingFact>();
  const entries = await Promise.all(
    destinations.map(async (city) => {
      const raw = await redis.get(cacheKey(city));
      if (!raw) return null;
      try {
        return [city, JSON.parse(raw) as CachedLodgingFact] as const;
      } catch {
        return null;
      }
    })
  );
  for (const e of entries) if (e) out.set(e[0], e[1]);
  return out;
}

/** The same entries, formatted for the prompt.
 *
 * A pure formatter over loadCachedLodgingEntries rather than a second read.
 * It used to issue its own redis.get and its own JSON.parse per city, and
 * index.ts calls both functions together in one Promise.all over the same
 * destinations - so a three-city trip made six round trips where three
 * would do, parsed every entry twice through two copies of the same
 * try/catch, and left open the possibility of the two disagreeing about
 * which cities are cached. That last one matters: `missing` is computed
 * from this function's answer and decides which cities get a live search. */
export async function loadCachedLodgingFacts(
  redis: Redis,
  destinations: string[]
): Promise<Record<string, string>> {
  const entries = await loadCachedLodgingEntries(redis, destinations);
  const result: Record<string, string> = {};
  for (const [city, fact] of entries) {
    result[city] = formatCachedFact(city, fact);
  }
  return result;
}

/** Shared write path - both the post-hoc extraction below and the
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
 * items and caches one per matched destination. Never throws - caching
 * must not affect the actual response. Mostly a fallback/backstop now that
 * prefetchLodging (index.ts) populates the cache upfront for anything
 * missing before generation even starts - this still catches whatever
 * that path didn't (e.g. testMode jobs, which skip prefetch entirely). */
export async function cacheLodgingFacts(redis: Redis, brief: TripBriefInput, itinerary: Itinerary): Promise<void> {
  try {
    const seen = new Set<string>();
    const writes: Promise<void>[] = [];
    for (const day of itinerary.days ?? []) {
      for (const item of day.items) {
        if (item.type !== "lodging") continue;
        if (item.confidence_tier !== "verified" && item.confidence_tier !== "single_source") continue;
        const dest = matchDestination(item.location, brief.destinations);
        if (!dest || seen.has(dest)) continue;
        seen.add(dest);

        // A price this cache would inject as fact, so it has to be one.
        //
        // There was no check at all. A lodging item shipping at 0 - the
        // exact failure quality.ts's prices_present check exists for - was
        // cached, and for the next ~20h every generation for that city was
        // told "the typical mid-range rate was verified via live search at
        // approx EUR0/night, do not perform a new accommodation search".
        // So the search that would have found the real number was
        // suppressed, and the trip's largest line was priced at zero. An
        // omitted field read "approx EURundefined/night". The prefetch's
        // own write path guards with `costEstimateEur != null &&
        // sourceUrl`; this shared one guarded with nothing.
        const price = item.cost_estimate_eur;
        if (!Number.isFinite(price) || price <= 0) continue;

        // Collected and awaited together: these are independent keys, and
        // writing them one after another made a multi-city trip pay one
        // Redis round-trip per destination in sequence.
        writes.push(
          (async () => {
            // MERGED with what is already there, not written over it.
            //
            // The comment this replaces claimed to carry the property
            // forward, and did not: `item.venue_name ?? undefined` is
            // undefined for an unnamed item, JSON.stringify drops the key,
            // and redis.set REPLACES the value - so a named entry became an
            // unnamed one, which is precisely what it said must not happen.
            // Reachable on every generation where checkVenues could not
            // confirm the property but the item kept its source_urls, and
            // `area` was dropped unconditionally because this path never
            // passed it. One extra GET, off the traveler's clock entirely.
            const existing = (await loadCachedLodgingEntries(redis, [dest])).get(dest);
            await writeCachedLodgingFact(redis, dest, {
              costEstimateEur: price,
              sourceUrls: item.source_urls ?? [],
              sourceAgreement: item.source_agreement ?? null,
              name: item.venue_name ?? existing?.name,
              area: existing?.area,
            });
          })()
        );
      }
    }
    await Promise.all(writes);
  } catch (e) {
    console.error("[worker] failed to cache lodging facts:", e);
  }
}
