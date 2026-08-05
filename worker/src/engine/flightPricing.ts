// Real flight-price lookup for the arrival flight item — an actual current
// fare, not a memory-based guess. The model's own guess repeatedly turned
// out badly wrong (confirmed: a "€150, likely with one connection" guess
// for a route that was actually a real, current €43 nonstop fare), which is
// why flightLinks.ts stopped showing that guess as a number at all and
// pointed to a real Google Flights link instead. This module is the next
// step: actually fetch a real fare, the same "verify structurally, don't
// trust the model's memory" principle as checkVenues (Google Places) —
// just for flights instead of venues.
//
// Uses Amadeus's self-service Flight Offers Search API — free-tier signup,
// same self-serve pattern as GOOGLE_PLACES_API_KEY. Entirely optional:
// no-ops (returns the itinerary unchanged) if AMADEUS_API_KEY/
// AMADEUS_API_SECRET aren't set, or if anything in the lookup fails, so a
// missing/misconfigured key or an API hiccup never breaks generation —
// falls back to the existing link-only display (see ItineraryResult.tsx).
//
// Honest caveat worth keeping in mind: Amadeus's free/test environment
// draws on a real but not always fully live-refreshed fare dataset, so this
// number, while a genuine market fare (not a memory guess), can still
// occasionally differ from what Google Flights shows at the exact same
// moment — categorically more trustworthy than an unaided guess, but not
// guaranteed to be pixel-identical to the linked Google Flights page.

import type { Itinerary, ItineraryItem, TripBriefInput } from "../types";

const AMADEUS_BASE_URL = process.env.AMADEUS_BASE_URL ?? "https://test.api.amadeus.com";

// Amadeus's test/sandbox environment is known to be slow, and none of the
// fetches below had a timeout — confirmed to be exactly what pushed real
// generation time toward 2 minutes (the same regression this file's own
// intro comment already documents once happening with the model's own
// flight search, see worker/src/index.ts). Every call here is optional by
// design (the whole module no-ops on any failure), so a slow provider
// should fail fast into that same fallback rather than stalling the entire
// job. These are generous relative to a normal Amadeus response (well under
// 1-2s) but cap the worst case: token+IATA+search timing out back-to-back
// is ~18s, not minutes.
const TOKEN_TIMEOUT_MS = 5_000;
const IATA_TIMEOUT_MS = 5_000;
const SEARCH_TIMEOUT_MS = 8_000;

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

// Module-level caches, scoped to this process's lifetime — an OAuth token
// and a city's IATA code are both stable for far longer than one
// generation, so reusing them across jobs avoids paying for a fresh lookup
// every single time (the same reasoning as the geocode cache in
// venueVerification.ts).
let cachedToken: CachedToken | null = null;
const iataCache = new Map<string, string | null>();

async function getAccessToken(apiKey: string, apiSecret: string): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5_000) {
    return cachedToken.token;
  }
  try {
    const res = await fetch(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: apiKey,
        client_secret: apiSecret,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 1800) * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}

async function resolveIataCode(token: string, cityName: string): Promise<string | null> {
  const key = cityName.trim().toLowerCase();
  if (iataCache.has(key)) return iataCache.get(key)!;

  try {
    const url =
      `${AMADEUS_BASE_URL}/v1/reference-data/locations?subType=CITY,AIRPORT&keyword=` +
      encodeURIComponent(cityName);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(IATA_TIMEOUT_MS),
    });
    if (!res.ok) {
      iataCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ iataCode?: string }> };
    const code = data.data?.[0]?.iataCode ?? null;
    iataCache.set(key, code);
    return code;
  } catch {
    iataCache.set(key, null);
    return null;
  }
}

interface FlightOffer {
  price?: { total?: string };
}

async function searchCheapestFare(
  token: string,
  originCode: string,
  destinationCode: string,
  departureDate: string,
  returnDate: string,
  adults: number
): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      originLocationCode: originCode,
      destinationLocationCode: destinationCode,
      departureDate,
      returnDate,
      adults: String(Math.max(1, Math.min(adults, 9))),
      currencyCode: "EUR",
      max: "5",
    });
    const res = await fetch(`${AMADEUS_BASE_URL}/v2/shopping/flight-offers?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: FlightOffer[] };
    const prices = (data.data ?? [])
      .map((offer) => Number(offer.price?.total))
      .filter((n) => Number.isFinite(n) && n > 0);
    return prices.length > 0 ? Math.min(...prices) : null;
  } catch {
    return null;
  }
}

// Matches the same title convention flightLinks.ts relies on (the system
// prompt has the model consistently title these "Flight X to Y").
function isFlightItem(item: ItineraryItem): boolean {
  return item.type === "transport" && /\bflight\b/i.test(item.title) && item.cost_estimate_eur > 0;
}

/** Replaces the model's own guessed fare on the arrival flight item with a
 * real, live-checked round-trip price from Amadeus — the departure leg
 * keeps its existing "free, already covered" treatment either way. Marks
 * the item "grounded" with the real Google Flights link as its source, so
 * it flows into the normal single_source confidence tier alongside every
 * other grounded item (see deriveConfidenceTiers in checks.ts) — no
 * special-casing needed downstream, and the frontend shows the real number
 * instead of the link-only fallback exactly when this succeeds (see
 * ItineraryResult.tsx's `source_confidence === "grounded"` check). */
export async function attachFlightPrices(itinerary: Itinerary, brief: TripBriefInput): Promise<Itinerary> {
  const apiKey = process.env.AMADEUS_API_KEY;
  const apiSecret = process.env.AMADEUS_API_SECRET;
  if (!apiKey || !apiSecret) return itinerary;
  if (!brief.origin?.trim() || brief.needs_flight === false) return itinerary;
  if (brief.destinations.length === 0) return itinerary;

  const days = itinerary.days ?? [];
  const firstDay = days[0];
  const arrivalItem = firstDay?.items.find(isFlightItem);
  if (!arrivalItem) return itinerary; // not a flight trip, or already free/unmatched

  const token = await getAccessToken(apiKey, apiSecret);
  if (!token) return itinerary;

  const origin = brief.origin.trim();
  const destination = brief.destinations[0];
  const [originCode, destinationCode] = await Promise.all([
    resolveIataCode(token, origin),
    resolveIataCode(token, destination),
  ]);
  if (!originCode || !destinationCode) return itinerary;

  const departureDate = brief.arrival_date?.trim() || brief.start_date;
  const returnDate = brief.end_date;
  const fare = await searchCheapestFare(token, originCode, destinationCode, departureDate, returnDate, brief.party_size);
  if (fare == null) return itinerary;

  arrivalItem.cost_estimate_eur = Math.round(fare);
  arrivalItem.source_confidence = "grounded";
  arrivalItem.source_urls = arrivalItem.flight_search_url ? [arrivalItem.flight_search_url] : [];
  arrivalItem.source_agreement = null;
  arrivalItem.reasoning =
    brief.party_size > 1
      ? `Checked live: this is today's real round-trip fare for the group, not a guess.`
      : `Checked live: this is today's real round-trip fare, not a guess.`;

  return itinerary;
}
