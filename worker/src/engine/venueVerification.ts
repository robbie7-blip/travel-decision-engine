// Real Google Places lookup for named-venue items (meals, and paid
// activities that stand in for a specific business — see the "NAME SPECIFIC
// VENUES" rule in prompt.ts) — the one thing the model's own web_search tool
// can't reliably give us: an actual Google rating, open/closed status, and
// price tier. Entirely optional: no-ops (returns the itinerary unchanged) if
// GOOGLE_PLACES_API_KEY isn't set, so a missing key never breaks generation.
//
// Deliberately annotate-and-warn, not reject-and-regenerate: replacing a
// flagged venue would mean another model round-trip per rejection (cost +
// latency), so for now a closed/low-rated venue is surfaced clearly via
// _venue_warnings rather than silently swapped out. A real reject/retry loop
// is a reasonable v2 if this isn't enough on its own.

import type { GoogleBusinessStatus, GooglePriceLevel, Itinerary } from "../types";

// Below this, a venue is flagged as a weak pick rather than silently trusted.
const MIN_RATING = 4.2;

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.rating,places.userRatingCount,places.businessStatus,places.priceLevel,places.id";

interface PlacesApiPlace {
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  priceLevel?: string; // e.g. "PRICE_LEVEL_INEXPENSIVE" — see mapPriceLevel
  id?: string;
}

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
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

async function lookupPlace(apiKey: string, query: string): Promise<PlacesApiPlace | null> {
  try {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PlacesApiResponse;
    return data.places?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Only meals and paid activities are expected to name a real venue (see the
 * prompt rule this mirrors) — free activities (a walk, browsing a market)
 * are deliberately left generic, so looking them up would just attach a
 * random top search result to something that was never meant to name a
 * business in the first place. */
function isNamedVenueItem(item: { type: string; cost_estimate_eur: number }): boolean {
  return item.type === "meal" || (item.type === "activity" && item.cost_estimate_eur > 0);
}

export async function checkVenues(itinerary: Itinerary): Promise<Itinerary> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return itinerary;

  const targets = (itinerary.days ?? []).flatMap((day) => day.items.filter(isNamedVenueItem));

  // Parallelized — these lookups are independent (each writes to a different
  // item), and running them sequentially would otherwise add a few seconds
  // per named venue to an already-slow generation.
  const results = await Promise.all(targets.map((item) => lookupPlace(apiKey, `${item.title}, ${item.location}`)));

  const warnings: string[] = [];
  targets.forEach((item, i) => {
    const place = results[i];
    if (!place) return;

    item.google_rating = place.rating;
    item.google_rating_count = place.userRatingCount;
    item.google_price_level = mapPriceLevel(place.priceLevel);
    item.google_business_status = mapBusinessStatus(place.businessStatus);
    if (place.id) {
      item.google_maps_url = `https://www.google.com/maps/place/?q=place_id:${place.id}`;
    }

    if (item.google_business_status === "closed_permanently") {
      warnings.push(`"${item.title}" appears permanently closed according to Google Places — treat as unreliable.`);
    } else if (place.rating != null && place.rating < MIN_RATING) {
      warnings.push(`"${item.title}" has a Google rating of ${place.rating.toFixed(1)} (below ${MIN_RATING}) — a weaker pick.`);
    }
  });

  itinerary._venue_warnings = warnings;
  return itinerary;
}
