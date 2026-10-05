// Looking a named place up in Google Places, for Ask a Local.
//
// Written because of a real answer a traveler got. Asked to compare two
// guesthouses by name, Ask a Local replied "I can't actually browse the
// internet or look up live listings, reviews, or current info on specific
// properties, even by name. I only work from what's given to me in our
// conversation." That was TRUE of the path it was on - live web search is
// Pro-only - and it is still the wrong answer, for two reasons. It
// describes its own plumbing to a customer, and the product could have
// answered: the Places key is configured here already (/api/venue-photo
// uses it) and the itinerary engine has confirmed venues with it all
// along. The capability existed and the question could not reach it.
//
// Deliberately NOT web search, so this changes nothing about the Pro
// gate. It answers one specific question - "is this real, and what is it
// like" - with facts Google holds about a business: whether it exists,
// how it is rated and by how many people, where it actually is, roughly
// what it costs, whether it is still operating.
//
// A separate implementation from the worker's venueVerification.ts rather
// than a shared one. That file decides whether an itinerary item survives
// - it removes venues, strips names, rejects on ratings, biases by
// coordinates and carries retry and concurrency policy for a whole trip's
// worth of lookups. None of that belongs in a conversational answer, and
// importing it would couple a chat route to the acceptance pipeline. What
// is shared is the API and the field names, which is Google's contract,
// not ours.

/** What the model is given back about a place. Deliberately small: these
 * are the facts that change an answer, and every extra field is one more
 * thing for a model to pad a reply with. */
export interface PlaceFacts {
  name: string;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** "OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY". The one
   * that matters most to a traveler about to book, and the one a model
   * working from training data cannot possibly know. */
  status: string | null;
  /** Google's own price band, e.g. "PRICE_LEVEL_MODERATE". */
  priceLevel: string | null;
  mapsUrl: string | null;
  openingHours: string[] | null;
}

export type PlaceLookupResult =
  | { status: "found"; place: PlaceFacts }
  | { status: "not_found" }
  /** Google could not be reached or refused. Distinct from not_found on
   * purpose: "we could not check" and "this does not appear to exist" are
   * very different things to tell someone about to book a room. */
  | { status: "unavailable"; reason: string };

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/** Short, because a person is waiting on a chat reply. The worker can
 * afford 8s per venue inside a background job; this cannot. */
const TIMEOUT_MS = 4000;

const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.priceLevel",
  "places.googleMapsUri",
  "places.regularOpeningHours.weekdayDescriptions",
].join(",");

interface PlacesApiPlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  priceLevel?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

/** Everything that comes back here is from Google, not from the traveler,
 * but it is still read defensively: this is a network payload typed by
 * assertion, which is not the same as a checked one. */
function toFacts(place: PlacesApiPlace): PlaceFacts {
  return {
    name: typeof place.displayName?.text === "string" ? place.displayName.text : "",
    address: typeof place.formattedAddress === "string" ? place.formattedAddress : null,
    rating: typeof place.rating === "number" ? place.rating : null,
    ratingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    status: typeof place.businessStatus === "string" ? place.businessStatus : null,
    priceLevel: typeof place.priceLevel === "string" ? place.priceLevel : null,
    mapsUrl: typeof place.googleMapsUri === "string" ? place.googleMapsUri : null,
    openingHours: Array.isArray(place.regularOpeningHours?.weekdayDescriptions)
      ? place.regularOpeningHours.weekdayDescriptions.filter((d): d is string => typeof d === "string")
      : null,
  };
}

/** One text search. `query` is the place name plus wherever it is, which
 * is how Places text search is meant to be asked ("Hotel Artemide Rome").
 *
 * No retry. The worker retries because a dropped lookup silently costs an
 * itinerary item its verification; here a failure becomes "I could not
 * check that one", which is a fine thing to say and much better than
 * making someone wait twice as long for it. */
export async function lookUpPlace(apiKey: string, query: string): Promise<PlaceLookupResult> {
  const trimmed = query.trim();
  if (!trimmed) return { status: "not_found" };
  try {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: trimmed, maxResultCount: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A 4xx or 5xx is Google failing us, never a verdict on the business.
    // Reporting a quota error as "that place does not exist" would be the
    // product inventing a fact about somewhere real.
    if (!res.ok) return { status: "unavailable", reason: `HTTP ${res.status}` };
    const data = (await res.json()) as { places?: PlacesApiPlace[] };
    const place = data.places?.[0];
    return place ? { status: "found", place: toFacts(place) } : { status: "not_found" };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timeout" : String(e);
    return { status: "unavailable", reason };
  }
}

/** The lookup result as the few lines of text the model is handed back.
 *
 * Prose rather than raw JSON because the model's job here is to answer a
 * person, and a labelled line it can quote beats a nested object it has
 * to interpret. The "could not check" wording is deliberate and is what
 * stops an outage turning into "I couldn't find that place". */
export function describePlace(query: string, result: PlaceLookupResult): string {
  if (result.status === "unavailable") {
    return `Lookup for "${query}" could not be completed (${result.reason}). This says nothing about whether the place exists - do not tell the traveler it was not found.`;
  }
  if (result.status === "not_found") {
    return `No Google Places match for "${query}". It may be listed under a different name, or be too small or too new to be listed.`;
  }
  const p = result.place;
  const lines = [`Google Places result for "${query}":`, `- Name: ${p.name}`];
  if (p.address) lines.push(`- Address: ${p.address}`);
  if (p.rating != null) {
    lines.push(`- Rating: ${p.rating}${p.ratingCount != null ? ` from ${p.ratingCount} reviews` : ""}`);
  } else {
    lines.push(`- Rating: none published`);
  }
  if (p.priceLevel) lines.push(`- Price level: ${p.priceLevel}`);
  if (p.status && p.status !== "OPERATIONAL") lines.push(`- Status: ${p.status}`);
  if (p.openingHours?.length) lines.push(`- Hours: ${p.openingHours.join("; ")}`);
  if (p.mapsUrl) lines.push(`- Google Maps: ${p.mapsUrl}`);
  return lines.join("\n");
}
