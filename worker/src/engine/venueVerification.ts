// Real Google Places lookup for named-venue items (meals, and any activity
// whose title names a specific business — see the "NAME SPECIFIC VENUES"
// rule in prompt.ts) — the one thing the model's own web_search tool can't
// reliably give us: an actual Google rating, open/closed status, and price
// tier. Entirely optional: no-ops (returns the itinerary unchanged) if
// GOOGLE_PLACES_API_KEY isn't set, so a missing key never breaks generation.
//
// Hard rule (non-negotiable): if a title names a specific business, that
// business must be confirmed to exist, open, and well-rated, with a real
// Maps link — or it doesn't appear at all. "Places found nothing," "found
// something that doesn't look like the same business," "closed (temporarily
// or permanently)," and "rated below the bar" are all treated the same way:
// the item is silently dropped from the itinerary. No warning is surfaced
// for this — the traveler doesn't need to know an item was swapped out, just
// see an itinerary made only of confirmed real places. Deliberately a single
// Places lookup per item with no follow-up model call for a replacement
// suggestion: an earlier version tried one real alternative via a small
// extra model round-trip per failing venue, but that meaningfully slowed
// generation (confirmed: ~90s vs ~40s on a trip with a few failures) for a
// step whose whole point was supposed to be fast. All lookups run in
// parallel regardless.
//
// Text Search alone is NOT a reliable geographic filter: confirmed in
// practice, it matched a same-or-similarly-named venue in a completely
// wrong place — a different city on the same island (~100km+ away), and
// once a same-named restaurant in New York for a Cyprus trip. namesLikelyMatch
// only checks the name, not the place, so a name match there wasn't enough
// to catch it. Fixed with a real geographic cross-check: the item's stated
// location is geocoded (Open-Meteo, free, no key — same provider already
// used for weather) to bias the Places search toward the right area AND to
// hard-reject a match that lands too far from where it should be, even if
// the name lined up.

import type { GoogleBusinessStatus, GooglePriceLevel, Itinerary, ItineraryItem } from "../types";

// Below this, a venue is dropped rather than shown.
const MIN_RATING = 4.2;

// A same-named match further than this from the item's stated location is
// treated as the wrong venue entirely, regardless of name similarity — chosen
// to comfortably cover a city's metro/outskirts sprawl while still rejecting
// a different city on the same island (Paphos-to-Nicosia-area is ~100km+)
// or, worse, a different country.
const MAX_MATCH_DISTANCE_KM = 60;
// Soft bias radius handed to Places itself, in meters — generous since the
// hard cutoff above is what actually enforces correctness.
const LOCATION_BIAS_RADIUS_M = 30000;

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FIELD_MASK =
  "places.rating,places.userRatingCount,places.businessStatus,places.priceLevel,places.id,places.displayName,places.location";

interface GeoPoint {
  latitude: number;
  longitude: number;
}

interface PlacesApiPlace {
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  priceLevel?: string; // e.g. "PRICE_LEVEL_INEXPENSIVE" — see mapPriceLevel
  id?: string;
  displayName?: { text?: string };
  location?: GeoPoint;
}

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
}

/** Great-circle distance in km — used to sanity-check a Places match against
 * where the item actually says it is, not just whether the name matches. */
function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function geocodeRaw(query: string): Promise<GeoPoint | null> {
  try {
    const res = await fetch(
      `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
    const r = data.results?.[0];
    return r ? { latitude: r.latitude, longitude: r.longitude } : null;
  } catch {
    return null;
  }
}

/** Geocodes an item's location string, memoized per unique string within one
 * checkVenues call (many items share the same destination city). Falls back
 * to the text after the last comma — usually the city, per the "location"
 * schema instruction requiring it be included — when the full string (often
 * "Neighborhood, City") doesn't resolve on its own. Returns null (skip the
 * geo cross-check for this item) rather than throwing, if both fail — a
 * geocoding hiccup should never block generation. */
function geocode(query: string, cache: Map<string, Promise<GeoPoint | null>>): Promise<GeoPoint | null> {
  const cached = cache.get(query);
  if (cached) return cached;

  const promise = (async () => {
    const direct = await geocodeRaw(query);
    if (direct) return direct;
    const commaIndex = query.lastIndexOf(",");
    if (commaIndex === -1) return null;
    return geocodeRaw(query.slice(commaIndex + 1).trim());
  })();

  cache.set(query, promise);
  return promise;
}

/** Loose overlap check between the venue name in the item's title and what
 * Text Search actually matched — normalizes case/accents/punctuation and
 * checks for a meaningful shared word, rather than an exact match (titles
 * and Google's listed name legitimately differ in small ways — "Restaurante
 * Vegetariano Apfel" vs "Apfel Vegetariano"). This exists specifically to
 * catch Text Search matching a WRONG business entirely (a stale/duplicate
 * listing, a similarly-named place in a different area) — confirmed to
 * happen in practice: three real, currently-operating restaurants all came
 * back "permanently closed" in one run, which is far more consistent with
 * mismatched listings than three coincidentally-wrong real closures. */
function namesLikelyMatch(venueName: string, placeName: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2); // skip short/common words (a, at, de, do...)

  const venueWords = new Set(normalize(venueName));
  const placeWords = normalize(placeName);
  if (venueWords.size === 0 || placeWords.length === 0) return false;
  return placeWords.some((w) => venueWords.has(w));
}

/** Pulls the venue's proper name out of a title phrased as "... at X" or
 * "... @ X" (the last such occurrence, so "Tattoo studio visit at Vodka
 * Tattoo" correctly yields "Vodka Tattoo") — deliberately general rather
 * than an enumerated prefix list (breakfast/lunch/tattoo session/etc.),
 * since that list missed real cases like "Tattoo studio visit at X" or any
 * other activity phrasing that doesn't start with one of the listed words.
 * Returns null (not a fallback to the full title) when no "at X" pattern is
 * found — that absence is exactly the signal isNamedVenueItem uses to tell
 * a genuinely generic title (a walk, a park visit) apart from one that
 * names a business and must be verified. */
function extractVenueName(title: string): string | null {
  const atRegex = /\bat\b/gi;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = atRegex.exec(title)) !== null) {
    lastIndex = match.index;
  }
  if (lastIndex === -1) return null;
  const rest = title.slice(lastIndex + 2).trim();
  return rest.length > 0 ? rest : null;
}

function mapPriceLevel(level?: string): GooglePriceLevel | undefined {
  switch (level) {
    case "PRICE_LEVEL_FREE":
      return "free";
    case "PRICE_LEVEL_INEXPENSIVE":
      return "inexpensive";
    case "PRICE_LEVEL_MODERATE":
      return "moderate";
    case "PRICE_LEVEL_EXPENSIVE":
      return "expensive";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "very_expensive";
    default:
      return undefined;
  }
}

function mapBusinessStatus(status?: string): GoogleBusinessStatus | undefined {
  switch (status) {
    case "OPERATIONAL":
      return "operational";
    case "CLOSED_TEMPORARILY":
      return "closed_temporarily";
    case "CLOSED_PERMANENTLY":
      return "closed_permanently";
    default:
      return undefined;
  }
}

// The documented Google Maps "Search" URL (not the `?q=place_id:` shorthand,
// which was confirmed NOT to work reliably — opening it just dumped the raw
// "place_id:XXX" string into the search box as literal text instead of
// resolving the place, giving "No results found"). This form requires a
// text query alongside query_place_id, which is why displayName is fetched.
function buildMapsUrl(placeName: string, placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}&query_place_id=${placeId}`;
}

async function lookupPlace(apiKey: string, query: string, bias?: GeoPoint | null): Promise<PlacesApiPlace | null> {
  try {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 1,
        ...(bias && {
          locationBias: { circle: { center: bias, radius: LOCATION_BIAS_RADIUS_M } },
        }),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PlacesApiResponse;
    return data.places?.[0] ?? null;
  } catch {
    return null;
  }
}

/** A "named venue" is any meal or activity whose title actually names a
 * business (extractVenueName found an "at X" pattern) — NOT based on
 * whether it costs money. A free activity can still name a real business
 * (e.g. "Tattoo studio visit at Vodka Tattoo", a no-charge browse) and must
 * be verified exactly like a paid one; a genuinely generic title (a walk, a
 * park visit) has no "at X" pattern at all and is correctly left alone. */
function isNamedVenueItem(item: { type: string; title: string }): boolean {
  return (item.type === "meal" || item.type === "activity") && extractVenueName(item.title) !== null;
}

function applyPlaceData(item: ItineraryItem, place: PlacesApiPlace): void {
  item.google_rating = place.rating;
  item.google_rating_count = place.userRatingCount;
  item.google_price_level = mapPriceLevel(place.priceLevel);
  item.google_business_status = mapBusinessStatus(place.businessStatus);
  if (place.id && place.displayName?.text) {
    item.google_maps_url = buildMapsUrl(place.displayName.text, place.id);
  }
}

export async function checkVenues(itinerary: Itinerary): Promise<Itinerary> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return itinerary;

  const targets = (itinerary.days ?? []).flatMap((day) => day.items.filter(isNamedVenueItem));
  const toRemove = new Set<ItineraryItem>();
  const geoCache = new Map<string, Promise<GeoPoint | null>>();

  await Promise.all(
    targets.map(async (item) => {
      // Safe: item is only in targets because isNamedVenueItem already
      // confirmed extractVenueName(item.title) is non-null.
      const venueName = extractVenueName(item.title)!;
      const bias = await geocode(item.location, geoCache);
      const place = await lookupPlace(apiKey, `${venueName}, ${item.location}`, bias);
      const placeName = place?.displayName?.text;
      const matched = place && placeName && namesLikelyMatch(venueName, placeName);

      if (!place || !matched) {
        toRemove.add(item); // couldn't confirm this business exists at all
        return;
      }

      // Name matched, but a same/similarly-named venue can still exist
      // somewhere entirely wrong — the failure mode confirmed in practice
      // (a different city, once a different country). Reject on distance
      // regardless of how well the name matched.
      if (bias && place.location && distanceKm(bias, place.location) > MAX_MATCH_DISTANCE_KM) {
        toRemove.add(item);
        return;
      }

      applyPlaceData(item, place);
      const status = item.google_business_status;
      if (status === "closed_permanently" || status === "closed_temporarily") {
        toRemove.add(item);
      } else if (place.rating != null && place.rating < MIN_RATING) {
        toRemove.add(item);
      }
    })
  );

  if (toRemove.size > 0) {
    for (const day of itinerary.days ?? []) {
      day.items = day.items.filter((item) => !toRemove.has(item));
    }
  }

  return itinerary;
}
