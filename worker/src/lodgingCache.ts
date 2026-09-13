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

/** Caps on the parts of an entry that get interpolated into the prompt, so
 * one oversized stored value cannot inflate every generation for that city
 * for the next ~20 hours. */
const MAX_SOURCE_URLS = 6;
const MAX_TEXT_CHARS = 120;

/** Upper bound on a nightly rate, in EUR.
 *
 * The prompt asks for "a mid-range hotel", so anything above this is not an
 * expensive city, it is a units mistake - a nightly rate read off a page
 * quoting the whole stay, or a currency with a thousand to the euro left
 * unconverted. Both are shapes a search-and-summarise call produces, and
 * both are unrecoverable here: there is no way to tell a five-night total
 * from one extravagant night, so the number is dropped and the frame's own
 * estimate is used instead.
 *
 * Deliberately generous rather than tight. A real suite in Zurich at €1,200
 * is a legitimate answer to a badly-phrased search, and refusing it would
 * trade a rare wrong price for a common missing one - and a missing rate
 * costs the generation twenty-odd seconds (see LodgingLookupResult.missing
 * in index.ts), so the floor and cap are here for the values that are
 * certainly wrong, not the ones that are merely surprising. */
const MAX_NIGHTLY_RATE_EUR = 5_000;

/** A nightly rate that can be shown to a traveler and priced against, or
 * null. NUMBERS ONLY - see readLodgingRateReply for the one caller that
 * coerces first, and why only that one does.
 *
 * The floor and the cap live here, shared, because they are the same
 * question on both paths: what may a price be at all. `> 0` rather than
 * `!= null`, which lets 0 and NaN through - 0 being the one that formatted
 * perfectly cleanly and told the model a rate had been verified at
 * EUR0/night. */
export function usableNightlyRate(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_NIGHTLY_RATE_EUR) return null;
  // Half a cent is not a price difference, and whole euros is what every
  // downstream figure is rounded to anyway.
  return Math.round(value);
}

/** The number inside a string a model wrote for a numeric field, or NaN.
 *
 * Accepts one number with optional currency decoration and thousands
 * separators around it, and refuses everything else - a range ("120-160")
 * and a hedge ("about 140, maybe more") both have to be refused, because
 * picking one end of a range is inventing a price. */
function parseCurrencyNumber(value: string): number {
  const stripped = value
    .trim()
    // Currency symbols and codes, on either side.
    .replace(/^(eur|usd|gbp|€|\$|£)\s*/i, "")
    .replace(/\s*(eur|usd|gbp|€|\$|£)$/i, "")
    // Thousands separators, but only between digit groups, so "1,200"
    // becomes 1200 while "1,2" is left to fail the test below.
    .replace(/(?<=\d),(?=\d{3}(\D|$))/g, "")
    .trim();
  // A plain decimal number and nothing else. Number("") is 0 and
  // Number(" ") is 0, which is why the pattern is required rather than
  // relying on Number() to refuse.
  return /^\d+(\.\d+)?$/.test(stripped) ? Number(stripped) : Number.NaN;
}

/** An http(s) URL a traveler can be shown as the source of a price, or null.
 *
 * `source_url` was carried straight from the model's JSON into
 * `source_urls`, which the trip page renders as the citation behind a
 * "verified" badge. So a reply of `"source_url": "booking.com"` or
 * `"(none found)"` - both things a model writes when it has nothing - put
 * an unclickable string behind a claim that the price had been checked.
 * Dropping it leaves `source_confidence` to speak for itself, which is
 * what the unnamed-source case already does. */
export function usableSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString().slice(0, 500);
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_TEXT_CHARS);
  return trimmed || undefined;
}

/** Whether what came back out of Redis is actually an entry.
 *
 * `JSON.parse(raw) as CachedLodgingFact` asserted a shape over a stored
 * value and both consumers then trusted it. Measured against the real
 * functions, five of eight malformed values THREW:
 *
 *   "null"                                  -> reading 'cachedAt' of null
 *   "{}" / "42" / "[]" / a bare string      -> reading 'length' of undefined
 *   {"costEstimateEur":140,"sourceUrls":"x"} -> sourceUrls.join is not a function
 *
 * and that throw happens in loadCachedLodgingFacts, which is awaited at the
 * TOP of every non-refinement generation (index.ts). So the job fails - and
 * fails again on every retry and every other traveller's trip to that city,
 * because the bad entry sits there for its full ~20h TTL.
 *
 * The sixth shape is worse for being silent: an entry at
 * costEstimateEur: 0 formats cleanly as "the typical mid-range rate was
 * verified via live search at approx EUR0/night ... do not perform a new
 * accommodation search". That is the exact defect the WRITE path was
 * guarded against, still fully reachable, because entries written before
 * that guard existed are still live - the type's own comment says as much
 * about `name`, and the same is true of every other field.
 *
 * Load-bearing claims are dropped rather than repaired: an entry whose
 * price or age cannot be trusted has no trip behind it worth keeping, and
 * dropping it puts the city back in `missing`, which buys a real live
 * search - the correct recovery, and the reason this cannot be a silent
 * repair. The decorative parts are sanitized instead, because an unnamed
 * entry is a documented, supported state. */
export function readCachedLodgingFact(value: unknown): CachedLodgingFact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  // A price this injects as established fact, so it has to be one - and a
  // shared floor/cap rather than `!= null`, which lets 0 and NaN through.
  // Entries written before the cap existed are still live for their ~20h
  // TTL, which is the whole reason this reader exists.
  const price = usableNightlyRate(raw.costEstimateEur);
  if (price === null) return null;

  // The age is part of the claim made to the model ("verified via live
  // search 3h ago"), and an entry that cannot be aged reads "NaNh ago".
  const cachedAt = raw.cachedAt;
  if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt)) return null;

  // Through the same URL gate as a live reply, because these end up in the
  // same place: source_urls on the accommodation entry, rendered on the
  // trip page as the citation behind a verified price. A stored
  // "(no source)" was previously kept and displayed as one.
  const sourceUrls = Array.isArray(raw.sourceUrls)
    ? raw.sourceUrls
        .map((u) => usableSourceUrl(u))
        .filter((u): u is string => u !== null)
        .slice(0, MAX_SOURCE_URLS)
    : [];
  const agreement = raw.sourceAgreement;

  return {
    costEstimateEur: price,
    sourceUrls,
    sourceAgreement: agreement === "agree" || agreement === "disagree" ? agreement : null,
    cachedAt,
    name: cleanText(raw.name),
    area: cleanText(raw.area),
  };
}

/** What the RATE half of the live lodging lookup actually returned.
 *
 * Both halves' replies were `JSON.parse(extractJson(text)) as T` - a type
 * assertion over a model's free-form output, trusted from there on. The
 * reply is a search-and-summarise answer, so every field can come back as
 * a shape the prompt did not ask for, and each one had somewhere to land:
 *
 *   {"cost_estimate_eur": "140"}      a string in a field typed `number`,
 *                                     which then propagated into
 *                                     cost_per_night_eur and into the
 *                                     trip's budget arithmetic
 *   {"cost_estimate_eur": "about 140"} the same, except the arithmetic
 *                                     produces NaN - so
 *                                     min_realistic_total_eur became NaN
 *                                     and the trip page showed it
 *   {"cost_estimate_eur": 0}          `!= null` is true, so this was a
 *                                     "grounded" free hotel, and the
 *                                     budget correction subtracted a whole
 *                                     trip's worth of accommodation
 *   {"cost_estimate_eur": 1e999}      JSON.parse yields Infinity
 *   {"source_url": "booking.com"}     shown as the citation behind the
 *                                     verified badge, unclickable
 *
 * Returning nulls rather than throwing is what makes this recoverable: the
 * caller's own emptiness check then treats a malformed reply exactly like
 * an empty one, which buys the retry that a malformed reply deserves, and
 * failing that the frame's estimate. */
export function readLodgingRateReply(value: unknown): {
  costEstimateEur: number | null;
  sourceUrl: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { costEstimateEur: null, sourceUrl: null };
  }
  const raw = value as Record<string, unknown>;
  // A numeric string is recovered HERE and nowhere else. `"140"`, `"€140"`
  // and `"140 EUR"` are all things a model emits for a field its prompt
  // documented as `<number>`, all three mean 140 unambiguously, and the
  // cost of refusing them on this path is real: no rate means phase 2 has
  // to wait for the trip frame, which is twenty-odd seconds of wall clock.
  //
  // The cache reader deliberately does NOT do this, and that is not drift.
  // A stored string is a value some older write path produced, its
  // provenance is unknown, and that module's rule is that a load-bearing
  // claim which cannot be trusted gets dropped rather than repaired -
  // dropping it puts the city back in `missing`, which buys a real live
  // search. Recovering here and refusing there also cannot strand
  // anything, because what gets written to the cache is the recovered
  // NUMBER, never the string.
  const cost = raw.cost_estimate_eur;
  const costEstimateEur = usableNightlyRate(
    typeof cost === "string" ? parseCurrencyNumber(cost) : cost
  );
  return {
    costEstimateEur,
    // A URL without a price behind it cites nothing: the price is the claim
    // the source is offered in support of, and carrying the URL alone put
    // a citation next to the frame's own guess.
    sourceUrl: costEstimateEur === null ? null : usableSourceUrl(raw.source_url),
  };
}

/** What the PROPERTY half returned.
 *
 * This is the half that used to THROW rather than degrade. The emptiness
 * check was `!v?.name?.trim()`, so a reply of `{"name": ["Hotel A", "Hotel
 * B"]}` - a model answering "find a hotel" with a shortlist - raised
 * "v.name.trim is not a function" inside prefetchLodging, outside every
 * try/catch in it. That rejects the pendingLodging promise, which
 * waitForLiveOrFallback deliberately propagates, which abandons the
 * two-phase path and regenerates the entire trip in one serial call: the
 * ~2-minute path this whole design exists to avoid, paid twice, because a
 * search returned two hotels instead of one. */
export function readLodgingPropertyReply(value: unknown): {
  name: string | null;
  area: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: null, area: null };
  }
  const raw = value as Record<string, unknown>;
  const name = cleanText(raw.name) ?? null;
  return {
    name,
    // An area with no property is a neighborhood attached to nothing: the
    // name is what buildDayPrompt renders it beside, and without one the
    // accommodation line is generic anyway.
    area: name === null ? null : (cleanText(raw.area) ?? null),
  };
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
        const fact = readCachedLodgingFact(JSON.parse(raw));
        return fact ? ([city, fact] as const) : null;
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
