// Real Google Places lookup for named-venue items (meals, and any activity
// whose title names a specific business — see the "NAME SPECIFIC VENUES"
// rule in prompt.ts) — the one thing the model's own web_search tool can't
// reliably give us: an actual Google rating, open/closed status, and price
// tier. Entirely optional: no-ops (returns the itinerary unchanged) if
// GOOGLE_PLACES_API_KEY isn't set, so a missing key never breaks generation.
//
// Hard rule (non-negotiable): if a title names a specific business, that
// business must be confirmed to exist and get a real Maps link, full stop.
// "Places found nothing" and "Places matched something, but it doesn't look
// like the same business" are both treated as failures, exactly like
// "permanently closed" or "rated below the bar" — there is no silent
// "leave it unverified" path. A failing venue gets ONE targeted replacement
// attempt (a small, tool-free follow-up call asking for a single real
// alternative, then re-verified the same way); if that also fails, the item
// is removed from the itinerary entirely rather than ever showing a
// business that couldn't be confirmed. This is deliberately not a full
// itinerary regeneration: only the specific failing item gets a small,
// cheap follow-up call, kept fast by running all items' checks (and any
// replacement attempts) in parallel.

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

/** A "named venue" is any meal or activity whose title actually names a
 * business (extractVenueName found an "at X" pattern) — NOT based on
 * whether it costs money. A free activity can still name a real business
 * (e.g. "Tattoo studio visit at Vodka Tattoo", a no-charge browse) and must
 * be verified exactly like a paid one; a genuinely generic title (a walk, a
 * park visit) has no "at X" pattern at all and is correctly left alone. */
function isNamedVenueItem(item: { type: string; title: string }): boolean {
  return (item.type === "meal" || item.type === "activity") && extractVenueName(item.title) !== null;
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
      // Safe: item is only in targets because isNamedVenueItem already
      // confirmed extractVenueName(item.title) is non-null.
      const venueName = extractVenueName(item.title)!;
      const place = await lookupPlace(apiKey, `${venueName}, ${item.location}`);
      const placeName = place?.displayName?.text;
      const matched = place && placeName && namesLikelyMatch(venueName, placeName);

      // Hard rule: a named venue must be confirmed to exist, full stop.
      // "Nothing found" and "found something, but it doesn't look like the
      // same business" are both failures here, exactly like "closed" or
      // "rated too low" below — there is no silent "leave it unverified"
      // outcome. A wrong match is also worse to act on than none, so it's
      // never applied to the item even when found.
      let reason: string | null = null;
      if (!place) {
        reason = "no matching business could be confirmed on Google Places";
      } else if (!matched) {
        reason = "the closest Google Places match doesn't look like the same business";
      } else {
        applyPlaceData(item, place);
        if (item.google_business_status === "closed_permanently") {
          reason = "it appears permanently closed on Google";
        } else if (place.rating != null && place.rating < MIN_RATING) {
          reason = `its Google rating is ${place.rating.toFixed(1)}, below this app's ${MIN_RATING} bar`;
        }
      }

      if (!reason) return; // confirmed real, open, and well-rated — done

      const suggestion = client && brief && model ? await suggestReplacement(client, model, item, brief, reason) : null;
      const newVenueName = suggestion ? extractVenueName(suggestion.title) : null;
      if (suggestion && newVenueName) {
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
      // out — remove rather than ever show an unconfirmed or failing venue.
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
