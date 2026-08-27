// ⚠️ THE AMADEUS SELF-SERVICE API CLOSED ON 17 JULY 2026.
//
// Everything in the fetch half of this file talks to endpoints that no
// longer serve self-service credentials, so fetchFarePricing returns null
// on its first line in production and always will. Flights fall back to the
// deterministic Google Flights deep link (see engine/flightLinks.ts), which
// is the documented, intended behaviour when no fare provider is
// configured — not a degradation.
//
// This is left in place rather than deleted because the SEAM is still the
// right one and is worth keeping if a provider is ever added: fetchFarePricing
// does the network work at t=0 and applyFlightPricing is pure, so only the
// fetching half is Amadeus-specific. A replacement needs to return a
// PrefetchedFare and nothing else changes.
//
// What replacing it would cost, checked August 2026: there is no longer a
// free real-fare tier for independent developers. Duffel's test mode returns
// sandbox data (fake airline, fake schedules, fake prices) and real fares
// need a live pay-as-you-go account; FlightAPI.io starts around $49/month;
// Kiwi and Skyscanner are partner programmes rather than self-serve.
//
// Worth being clear about why that is not urgent: the Google Flights link
// shows the traveler the REAL price in one tap, and this product already
// learned the hard way that a confident wrong fare is worse than an honest
// link — a live test once had the model reporting a "verified" EUR240 round
// trip directly above a link showing EUR43 for the same route and dates.
//
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

// Every failure here is already silently swallowed by design (the whole
// module no-ops back to the link-only fallback), which is the right
// behavior for the job — but silent means invisible in the worker's own
// logs too, so a real outage or a timeout creeping back up would look
// identical to "nobody has Amadeus keys configured." This logs loudly
// enough to spot in `railway logs`/etc. without throwing or slowing
// anything down. Distinguishes a timeout (the specific failure mode this
// module was just fixed for) from any other fetch error, since a timeout
// recurring is the signal that TOKEN_TIMEOUT_MS/IATA_TIMEOUT_MS/
// SEARCH_TIMEOUT_MS need revisiting, whereas some other error is more
// likely an Amadeus outage or a bad response shape.
function logFailure(step: string, e: unknown): void {
  const timedOut = e instanceof Error && e.name === "TimeoutError";
  console.warn(
    `[flightPricing] ${step} ${timedOut ? "timed out" : "failed"} — falling back to link-only display.` +
      (timedOut ? "" : ` (${e instanceof Error ? e.message : String(e)})`)
  );
}

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
    if (!res.ok) {
      console.warn(`[flightPricing] token request rejected: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 1800) * 1000 };
    return cachedToken.token;
  } catch (e) {
    logFailure("token request", e);
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
      console.warn(`[flightPricing] IATA lookup for "${cityName}" rejected: HTTP ${res.status}`);
      iataCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ iataCode?: string }> };
    const code = data.data?.[0]?.iataCode ?? null;
    iataCache.set(key, code);
    return code;
  } catch (e) {
    logFailure(`IATA lookup for "${cityName}"`, e);
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
    if (!res.ok) {
      console.warn(`[flightPricing] fare search rejected: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { data?: FlightOffer[] };
    const prices = (data.data ?? [])
      .map((offer) => Number(offer.price?.total))
      .filter((n) => Number.isFinite(n) && n > 0);
    return prices.length > 0 ? Math.min(...prices) : null;
  } catch (e) {
    logFailure("fare search", e);
    return null;
  }
}

const METRICS_TIMEOUT_MS = 6_000;

/** Amadeus's itinerary price metrics: the historical price distribution for
 * a route and departure date, as quartile points. This is what makes an
 * honest "is this a good price?" possible without predicting anything — we
 * report where today's real fare falls in a range that actually happened.
 *
 * Route coverage is genuinely partial (thin regional routes frequently have
 * no history at all), so returning null is a normal, expected outcome and
 * every caller must treat it as "say nothing" rather than "assume typical".
 * Saying nothing is the correct behaviour for this product: an invented
 * price judgement is exactly the kind of confident-but-unfounded claim the
 * whole confidence-tier system exists to prevent. */
async function fetchPriceMetrics(
  token: string,
  originCode: string,
  destinationCode: string,
  departureDate: string,
  oneWay: boolean
): Promise<{ firstEur: number; thirdEur: number } | null> {
  try {
    const params = new URLSearchParams({
      originIataCode: originCode,
      destinationIataCode: destinationCode,
      departureDate,
      currencyCode: "EUR",
      oneWay: String(oneWay),
    });
    const res = await fetch(`${AMADEUS_BASE_URL}/v1/analytics/itinerary-price-metrics?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(METRICS_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 404/400 here overwhelmingly means "no history for this route",
      // which is ordinary — log at a lower key than a real failure.
      console.warn(`[flightPricing] no price history for ${originCode}-${destinationCode} (HTTP ${res.status})`);
      return null;
    }
    const data = (await res.json()) as {
      data?: { priceMetrics?: { amount?: string; quartileRanking?: string }[] }[];
    };
    const metrics = data.data?.[0]?.priceMetrics ?? [];
    const at = (ranking: string): number | null => {
      const raw = metrics.find((m) => m.quartileRanking === ranking)?.amount;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const firstEur = at("FIRST");
    const thirdEur = at("THIRD");
    if (firstEur == null || thirdEur == null || thirdEur < firstEur) return null;
    return { firstEur, thirdEur };
  } catch (e) {
    logFailure("price metrics", e);
    return null;
  }
}

/** One observed fare, handed to the caller so it can be recorded. Kept as a
 * callback rather than writing to Redis in here, so this module stays free
 * of storage concerns exactly like the rest of engine/. */
export interface FareObservation {
  originCode: string;
  destinationCode: string;
  departureDate: string;
  fareEur: number;
  observedAt: number;
  /** Days between observing the fare and flying — the axis any future
   * prediction actually needs, and impossible to reconstruct later from a
   * bare timestamp once the departure date has passed. */
  daysBeforeDeparture: number;
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
export interface PrefetchedFare {
  fareEur: number;
  metrics: { firstEur: number; thirdEur: number } | null;
  adults: number;
}

/** The Amadeus half of flight pricing, which depends ONLY on the trip brief
 * — origin, destination, dates, party size. It used to run after generation
 * finished, purely because that's where the itinerary was available to
 * write into, which put a provider this module's own header calls slow
 * squarely on the critical path for no reason. Started at t=0 instead and
 * awaited at the end, it costs nothing at all in wall time. */
export async function fetchFarePricing(brief: TripBriefInput): Promise<PrefetchedFare | null> {
  const apiKey = process.env.AMADEUS_API_KEY;
  const apiSecret = process.env.AMADEUS_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  if (!brief.origin?.trim() || brief.needs_flight === false) return null;
  if (brief.destinations.length === 0) return null;

  const token = await getAccessToken(apiKey, apiSecret);
  if (!token) return null;

  const [originCode, destinationCode] = await Promise.all([
    resolveIataCode(token, brief.origin.trim()),
    resolveIataCode(token, brief.destinations[0]),
  ]);
  if (!originCode || !destinationCode) return null;

  const departureDate = brief.arrival_date?.trim() || brief.start_date;
  const adults = Math.max(1, Math.min(brief.party_size, 9));
  const startedAt = Date.now();
  const [fare, metrics] = await Promise.all([
    searchCheapestFare(token, originCode, destinationCode, departureDate, brief.end_date, brief.party_size),
    fetchPriceMetrics(token, originCode, destinationCode, departureDate, false),
  ]);
  console.log(`[flightPricing] amadeus lookups took ${Date.now() - startedAt}ms`);
  if (fare == null) return null;

  lastObservation = {
    originCode,
    destinationCode,
    departureDate,
    fareEur: Math.round(fare),
    observedAt: Date.now(),
    daysBeforeDeparture: Math.round((new Date(`${departureDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000),
  };
  return { fareEur: fare, metrics, adults };
}

let lastObservation: FareObservation | null = null;

/** Applies an already-fetched fare to the itinerary. Pure bookkeeping — no
 * network — so it adds nothing to the critical path. */
export function applyFlightPricing(
  itinerary: Itinerary,
  brief: TripBriefInput,
  prefetched: PrefetchedFare | null,
  onFareObserved?: (obs: FareObservation) => void
): Itinerary {
  if (!prefetched) return itinerary;
  const arrivalItem = (itinerary.days ?? [])[0]?.items.find(isFlightItem);
  if (!arrivalItem) return itinerary;

  const { fareEur: fare, metrics, adults } = prefetched;
  arrivalItem.cost_estimate_eur = Math.round(fare);
  arrivalItem.source_confidence = "grounded";
  arrivalItem.source_urls = arrivalItem.flight_search_url ? [arrivalItem.flight_search_url] : [];
  arrivalItem.source_agreement = null;
  arrivalItem.reasoning =
    brief.party_size > 1
      ? `Checked live: this is today's real round-trip fare for the group, not a guess.`
      : `Checked live: this is today's real round-trip fare, not a guess.`;

  if (lastObservation) onFareObserved?.(lastObservation);

  if (metrics) {
    const perPassenger = fare / adults;
    arrivalItem.fare_price_context = {
      level: perPassenger <= metrics.firstEur ? "low" : perPassenger <= metrics.thirdEur ? "typical" : "high",
      typicalLowEur: Math.round(metrics.firstEur * adults),
      typicalHighEur: Math.round(metrics.thirdEur * adults),
    };
  }
  return itinerary;
}

export async function attachFlightPrices(
  itinerary: Itinerary,
  brief: TripBriefInput,
  onFareObserved?: (obs: FareObservation) => void
): Promise<Itinerary> {
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

  // Both calls need only the token and the two IATA codes, so they run
  // together rather than back to back. Sequentially these stacked their
  // timeouts (8s + 6s) onto a provider whose own test environment this
  // module already documents as slow — pure added latency for no ordering
  // reason, since neither result feeds the other.
  const startedAt = Date.now();
  const [fare, metrics] = await Promise.all([
    searchCheapestFare(token, originCode, destinationCode, departureDate, returnDate, brief.party_size),
    fetchPriceMetrics(token, originCode, destinationCode, departureDate, false),
  ]);
  console.log(`[flightPricing] amadeus lookups took ${Date.now() - startedAt}ms`);
  if (fare == null) return itinerary;

  arrivalItem.cost_estimate_eur = Math.round(fare);
  arrivalItem.source_confidence = "grounded";
  arrivalItem.source_urls = arrivalItem.flight_search_url ? [arrivalItem.flight_search_url] : [];
  arrivalItem.source_agreement = null;
  arrivalItem.reasoning =
    brief.party_size > 1
      ? `Checked live: this is today's real round-trip fare for the group, not a guess.`
      : `Checked live: this is today's real round-trip fare, not a guess.`;

  // Every real fare we look up is worth keeping, whether or not the
  // provider has history for this route today. This is the only place a
  // genuine, timestamped market price passes through the system, so it's
  // the one chance to accumulate a price history of our own — the thing
  // any future "will this get cheaper?" would have to be built on, and
  // something no amount of prompting can substitute for.
  const msPerDay = 86_400_000;
  const daysBeforeDeparture = Math.round(
    (new Date(`${departureDate}T00:00:00Z`).getTime() - Date.now()) / msPerDay
  );
  onFareObserved?.({
    originCode,
    destinationCode,
    departureDate,
    fareEur: Math.round(fare),
    observedAt: Date.now(),
    daysBeforeDeparture,
  });

  // Per-passenger, because the quartiles the provider returns are for one
  // traveller — comparing a family's total against them would read as
  // wildly expensive on every group trip.
  const adults = Math.max(1, Math.min(brief.party_size, 9));
  const perPassenger = fare / adults;
  if (metrics) {
    arrivalItem.fare_price_context = {
      level: perPassenger <= metrics.firstEur ? "low" : perPassenger <= metrics.thirdEur ? "typical" : "high",
      typicalLowEur: Math.round(metrics.firstEur * adults),
      typicalHighEur: Math.round(metrics.thirdEur * adults),
    };
  }

  return itinerary;
}
