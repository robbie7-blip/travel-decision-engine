// Real Google Places lookup for named-venue items (meals, and paid
// activities that stand in for a specific business — see the "NAME SPECIFIC
// VENUES" rule in prompt.ts) — the one thing the model's own web_search tool
// can't reliably give us: an actual Google rating, open/closed status, and
// price tier. Entirely optional: no-ops (returns the itinerary unchanged) if
// GOOGLE_PLACES_API_KEY isn't set, so a missing key never breaks generation.
//
// A venue that fails verification (permanently closed, or rated below
// MIN_RATING) gets ONE targeted replacement attempt — a small, tool-free
// follow-up call asking for a single alternative, then re-verified the same
// way — rather than just a warning label next to a pick that shouldn't have
// been shown at all. If the replacement also fails (or no client/brief is
// available), the item is removed from the itinerary entirely instead of
// ever presenting an unreliable venue as the plan. This is deliberately not
// a full itinerary regeneration: only the specific failing item gets a
// small, cheap follow-up call, kept fast by running all items' checks (and
// any replacement attempts) in parallel.

import type Anthropic from "@anthropic-ai/sdk";
import type { GoogleBusinessStatus, GooglePriceLevel, Itinerary, ItineraryItem, TripBriefInput } from "../types";

// Below this, a venue gets one replacement attempt rather than being shown.
const MIN_RATING = 4.2;

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.rating,places.userRatingCount,places.businessStatus,places.priceLevel,places.id,places.displayName";

interface PlacesApiPlace {
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  priceLevel?: string; // e.g. "PRICE_LEVEL_INEXPENSIVE" — see mapPriceLevel
  id?: string;
  displayName?: { text?: string };
}

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
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

/** Strips a leading "Lunch at "/"Dinner at "/etc. prefix so both the search
 * query and the name-match check target just the venue's proper name, not
 * the whole item title. Falls back to the full title if no such prefix is
 * present (e.g. an activity title that isn't phrased that way). */
function extractVenueName(title: string): string {
  const match = /^(?:breakfast|brunch|lunch|dinner|snack|coffee|tattoo session|visit|tour)\s+(?:at|@)\s+(.+)$/i.exec(
    title.trim()
  );
  return match ? match[1] : title;
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

function extractJsonLoose(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const parts = t.split("```");
    t = parts[1] ?? t;
    if (t.startsWith("json")) t = t.slice(4);
  }
  return t.trim().replace(/,(\s*[}\]])/g, "$1");
}

/** One small, tool-free follow-up call asking for a single alternative venue
 * — deliberately not a full itinerary regeneration, just enough context to
 * pick a real, constraint-respecting replacement for the one item that
 * failed verification. */
async function suggestReplacement(
  client: Anthropic,
  model: string,
  item: ItineraryItem,
  brief: TripBriefInput,
  reason: string
): Promise<{ title: string; reasoning: string } | null> {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content:
            `A travel itinerary item needs a replacement: "${item.title}" (${item.type}) in ${item.location}, ` +
            `${reason}.\n\n` +
            `Traveler context — dietary constraints: ${brief.dietary_constraints.join(", ") || "none"}; ` +
            `interests: ${brief.interests.join(", ") || "general sightseeing"}; ` +
            `mobility constraints: ${brief.mobility_constraints.join(", ") || "none"}.\n\n` +
            `Suggest ONE real, specific, well-known alternative ${item.type === "meal" ? "restaurant" : "venue"} ` +
            `in the same area that fits this traveler. Respond with ONLY this JSON, no other text:\n` +
            `{"title": "${item.type === "meal" ? "Dinner at ..." : "..."}", "reasoning": "one short sentence"}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(extractJsonLoose(text));
    if (typeof parsed.title === "string" && typeof parsed.reasoning === "string") {
      return { title: parsed.title, reasoning: parsed.reasoning };
    }
    return null;
  } catch {
    return null;
  }
}

function passesBar(place: PlacesApiPlace | null): boolean {
  if (!place) return false;
  const status = mapBusinessStatus(place.businessStatus);
  if (status === "closed_permanently") return false;
  if (place.rating != null && place.rating < MIN_RATING) return false;
  return true;
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

export async function checkVenues(
  itinerary: Itinerary,
  client?: Anthropic,
  brief?: TripBriefInput,
  model?: string
): Promise<Itinerary> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return itinerary;

  const targets = (itinerary.days ?? []).flatMap((day) => day.items.filter(isNamedVenueItem));
  const toRemove = new Set<ItineraryItem>();
  const warnings: string[] = [];

  await Promise.all(
    targets.map(async (item) => {
      const venueName = extractVenueName(item.title);
      const place = await lookupPlace(apiKey, `${venueName}, ${item.location}`);
      if (!place) return; // no confident lookup — leave the item as-is, unverified

      // Skip entirely rather than trust a Text Search result that doesn't
      // actually look like the venue we asked about — a wrong match is
      // worse to act on than nothing, especially for a "closed" flag, which
      // actively damages trust if wrong.
      const placeName = place.displayName?.text;
      if (!placeName || !namesLikelyMatch(venueName, placeName)) return;

      applyPlaceData(item, place);
      if (passesBar(place)) return; // good venue, nothing more to do

      const reason =
        item.google_business_status === "closed_permanently"
          ? "it appears permanently closed on Google"
          : `its Google rating is ${place.rating?.toFixed(1)}, below this app's ${MIN_RATING} bar`;

      const suggestion = client && brief && model ? await suggestReplacement(client, model, item, brief, reason) : null;
      if (suggestion) {
        const newVenueName = extractVenueName(suggestion.title);
        const newPlace = await lookupPlace(apiKey, `${newVenueName}, ${item.location}`);
        const newPlaceName = newPlace?.displayName?.text;
        const newMatches = newPlace && newPlaceName && namesLikelyMatch(newVenueName, newPlaceName);

        if (newMatches && passesBar(newPlace)) {
          item.title = suggestion.title;
          item.reasoning = `${item.reasoning} (Swapped from the original pick since ${reason} — this one's real, open, and well-rated.)`;
          item.source_confidence = "inferred";
          applyPlaceData(item, newPlace!);
          return; // replacement succeeded, done
        }
      }

      // No client/brief available, or the replacement itself didn't pan
      // out — remove rather than ever show a venue that failed the bar.
      toRemove.add(item);
      warnings.push(
        `Removed "${item.title}" from the itinerary — ${reason}, and no solid automatic replacement was ` +
          `found. Consider picking your own ${item.type === "meal" ? "meal" : "activity"} for this slot.`
      );
    })
  );

  if (toRemove.size > 0) {
    for (const day of itinerary.days ?? []) {
      day.items = day.items.filter((item) => !toRemove.has(item));
    }
  }

  itinerary._venue_warnings = warnings;
  return itinerary;
}
