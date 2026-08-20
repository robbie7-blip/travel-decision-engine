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
//
// Two floors, because the two kinds of venue are not the same decision. A
// restaurant is SUBSTITUTABLE — there is always another good one, so the
// bar can be set where a traveler would set it. A landmark is not: the
// Pantheon is the Pantheon, and dropping it because its average sits at 4.1
// would remove the reason the day exists and leave a hole nothing can fill.
const MIN_RATING_MEAL = 4.3;
const MIN_RATING_ACTIVITY = 4.2;

// ...and above this review count, rating is not allowed to reject an
// activity at all. A place with this many reviews is a real destination in
// its own right — a major museum, a basilica, a ruin — and its average says
// something about queues and crowds rather than about whether it is worth
// seeing. This is a latent bug being closed rather than a preference: the
// single 4.2 floor applied to landmarks too, so a heavily-reviewed sight
// rated just under it would have been silently deleted from the itinerary
// with no warning and no replacement.
const LANDMARK_RATING_COUNT = 25000;

function minRatingFor(item: ItineraryItem): number {
  return item.type === "meal" ? MIN_RATING_MEAL : MIN_RATING_ACTIVITY;
}

// ...but only once the average is built on enough reviews to mean anything.
// Without this, the rating gate was strictly backwards at the low-sample
// end: a 5.0 from 2 reviews sailed through while a 3.9 from 5,000 was
// dropped, and the UI then printed that 2-review average next to the venue
// as if it were a credential. On a product whose entire pitch is that its
// signals are earned, an unearned one is worse than none — so below this
// count the rating is neither trusted for the accept/reject decision nor
// shown to the traveler. The venue itself still stands (it's a real,
// confirmed business, with its real Maps link); we just don't pretend to
// know how good it is.
const MIN_RATING_COUNT = 20;

function hasReliableRating(place: PlacesApiPlace): boolean {
  return place.rating != null && (place.userRatingCount ?? 0) >= MIN_RATING_COUNT;
}

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

// Both of these sit on the generation critical path, once per named venue,
// and neither had a timeout — so a slow or unresponsive Google could hold a
// traveler's generation open indefinitely with nothing to cap it. Amadeus
// was given timeouts after exactly this failure mode was confirmed to push
// real generations past two minutes (see engine/flightPricing.ts); these
// were simply missed at the time.
//
// Generous rather than tight: the goal is to bound a hang, not to abandon a
// call that is merely taking its time. Every lookup runs in parallel, so
// the worst case is one of these, not N of them.
const PLACES_TIMEOUT_MS = 8000;
const GEOCODE_TIMEOUT_MS = 5000;
const FIELD_MASK =
  "places.rating,places.userRatingCount,places.businessStatus,places.priceLevel,places.id," +
  "places.displayName,places.location,places.regularOpeningHours";

interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Google's weekly hours. `day` is 0 = Sunday through 6 = Saturday. A
 * period whose close.day differs from its open.day runs past midnight,
 * which is normal for bars and late kitchens and is handled explicitly
 * below rather than being quietly mis-read as "closed". */
export interface PlacesOpeningPeriod {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
}

export interface PlacesApiPlace {
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  priceLevel?: string; // e.g. "PRICE_LEVEL_INEXPENSIVE" — see mapPriceLevel
  id?: string;
  displayName?: { text?: string };
  location?: GeoPoint;
  regularOpeningHours?: {
    periods?: PlacesOpeningPeriod[];
    weekdayDescriptions?: string[];
  };
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
      `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
      { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
    const r = data.results?.[0];
    return r ? { latitude: r.latitude, longitude: r.longitude } : null;
  } catch {
    return null;
  }
}

/** The "City" part of a "Neighborhood, City" location string (or the whole
 * string if there's no comma) — per the "location" schema instruction
 * requiring the destination city always be included. Used both as the
 * primary geocoding query AND as the cache key, so every item in the same
 * city (regardless of which neighborhood each names) shares one geocode
 * lookup instead of one per distinct location string — the difference
 * between one network round-trip per destination city and one per
 * neighborhood, which matters since this sits in the generation critical
 * path. */
function cityPart(location: string): string {
  const commaIndex = location.lastIndexOf(",");
  return commaIndex === -1 ? location.trim() : location.slice(commaIndex + 1).trim();
}

/** Geocodes an item's location, memoized per city within one checkVenues
 * call. Tries the extracted city name first (the common, fast-resolving
 * case) and only falls back to the full raw string — a second sequential
 * fetch — if that fails, since a neighborhood name is rarely more
 * geocodable than the city it's in. Returns null (skip the geo cross-check
 * for this item) rather than throwing if both fail — a geocoding hiccup
 * should never block generation. */
function geocode(location: string, cache: Map<string, Promise<GeoPoint | null>>): Promise<GeoPoint | null> {
  const key = cityPart(location);
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const direct = await geocodeRaw(key);
    if (direct) return direct;
    if (key === location.trim()) return null; // nothing left to try
    return geocodeRaw(location);
  })();

  cache.set(key, promise);
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
 * found.
 *
 * LEGACY FALLBACK ONLY — English titles only, since "at" isn't how other
 * languages phrase this (confirmed: this used to be the ONLY detection
 * method, and it silently broke venue verification, Maps links, AND the
 * "hard rule, non-negotiable" real-business check entirely for every
 * non-English trip, since titles follow the trip's response language). The
 * primary path is item.venue_name below, a structured field the model sets
 * directly per prompt.ts's LANGUAGE-INDEPENDENT FIELDS instruction. This
 * regex only still runs for itineraries cached before that field existed. */
function extractVenueNameFromTitle(title: string): string | null {
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

/** Resolves the venue name to verify: prefers the model's own structured
 * venue_name field, falling back to the legacy title-regex only when that
 * field is absent (an itinerary cached before this field existed) — see
 * extractVenueNameFromTitle's header for why the regex alone isn't enough
 * on its own for a non-English trip. */
function resolveVenueName(item: { title: string; venue_name?: string | null }): string | null {
  if (item.venue_name) return item.venue_name;
  if (item.venue_name === undefined) return extractVenueNameFromTitle(item.title);
  return null; // venue_name explicitly null — model says this item doesn't name one
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

/** Three outcomes, not two.
 *
 * "Places has no such business" and "Places did not answer" used to be the
 * same value — null — and null meant delete the item. So a Google outage,
 * a quota rejection, or one slow response did not degrade verification, it
 * stripped every named venue out of the itinerary and handed the traveler a
 * trip with no restaurants in it. The pipeline would have reported that as
 * a successful generation.
 *
 * An unanswered lookup now leaves the item exactly as it was: named, shown,
 * and simply not carrying a verification badge it never earned. That is the
 * honest outcome when the verifier itself is down. */
type PlaceLookup =
  | { status: "found"; place: PlacesApiPlace }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

async function lookupPlace(
  apiKey: string,
  query: string,
  bias?: GeoPoint | null
): Promise<PlaceLookup> {
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
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
    // A 4xx/5xx is the API failing us, not a verdict on the venue — a 429
    // over quota or a 500 would otherwise read as "this restaurant does not
    // exist" for every item in the trip at once.
    if (!res.ok) return { status: "unavailable", reason: `HTTP ${res.status}` };
    const data = (await res.json()) as PlacesApiResponse;
    const place = data.places?.[0];
    return place ? { status: "found", place } : { status: "not_found" };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timeout" : String(e);
    return { status: "unavailable", reason };
  }
}

/** A "named venue" is any meal or activity whose title actually names a
 * business (resolveVenueName found one) — NOT based on whether it costs
 * money. A free activity can still name a real business (e.g. "Tattoo
 * studio visit at Vodka Tattoo", a no-charge browse) and must be verified
 * exactly like a paid one; a genuinely generic title (a walk, a park visit)
 * resolves to null and is correctly left alone. */
function isNamedVenueItem(item: { type: string; title: string; venue_name?: string | null }): boolean {
  // Accommodation is verified ONLY off an explicit venue_name, never off
  // the legacy title regex the other types fall back to. That regex keys
  // on the last " at " in a title, which is a good signal in "Lunch at
  // Mocotó" and a bad one in "Second night at the central Chisinau hotel"
  // — it would extract "the central Chisinau hotel" and either burn a
  // lookup failing to match it or, worse, match some unrelated hotel and
  // hang a confident Maps link off it.
  if (item.type === "lodging") return Boolean(item.venue_name);
  return (item.type === "meal" || item.type === "activity") && resolveVenueName(item) !== null;
}

/** Accommodation is verified like any other venue but can NEVER be removed
 * on a failed lookup, unlike a meal or activity. Dropping a lodging item
 * doesn't just lose a suggestion — it silently breaks the itinerary's
 * arithmetic: one item per night is what the budget total and
 * checkBudgetIntegrity's night count are both built on, and a trip that
 * quietly loses a night's accommodation cost understates its own budget.
 * An unconfirmable hotel therefore keeps its item and simply loses its
 * name (see stripUnverifiedLodging), which downgrades it to the honest
 * generic accommodation it would have been anyway. */
function isLodging(item: ItineraryItem): boolean {
  return item.type === "lodging";
}

/** Reverts an item to its unnamed form: no venue_name (so nothing
 * downstream treats it as a confirmed venue) and no Places fields. Named
 * for its original and still-primary caller, lodging, but also used for any
 * item the second pass must keep rather than delete (see keepUnverified). The
 * title is deliberately left alone — it's written in the trip's own
 * language, so rewriting it here would either break localization or
 * require re-calling the model for a cosmetic fix. Its confidence tier
 * still reflects the price grounding, which is unaffected by whether the
 * property itself checked out. */
function stripUnverifiedLodging(item: ItineraryItem): void {
  item.venue_name = null;
  item.google_rating = undefined;
  item.google_rating_count = undefined;
  item.google_price_level = undefined;
  item.google_business_status = undefined;
  item.google_maps_url = undefined;
}

/** Minutes past midnight on the given weekday, as one number, so an
 * overnight period ("Fri 18:00 – Sat 02:00") is a simple range comparison
 * instead of a special case. Sunday is 0, matching Google. */
function weekMinute(day: number, hour: number, minute: number): number {
  return day * 24 * 60 + hour * 60 + minute;
}

/** The hour an item is scheduled at, from either a clock time ("19:30") or
 * a time-of-day phrase. Returns null when neither is present — an item with
 * no time cannot be checked against opening hours, and guessing one would
 * manufacture a closure that isn't real. */
function scheduledMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const m = /(\d{1,2})[:.](\d{2})/.exec(time);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h * 60 + min;
  }
  const t = time.toLowerCase();
  // "afternoon" is tested BEFORE "noon", and "noon" only with word
  // boundaries, because "afternoon" contains "noon" — which silently placed
  // every afternoon item at 13:00 and would have declared a venue open
  // through a 15:00–19:00 closure.
  //
  // Times are deliberately mid-slot rather than at the edges: a lunch place
  // that opens at 12:00 should not read as closed because "midday" was
  // taken to mean 11:00.
  if (/morning|закуск|matin|mañana/.test(t)) return 9 * 60 + 30;
  if (/afternoon|следобед/.test(t)) return 15 * 60 + 30;
  if (/midday|\bnoon\b|lunch|об[яе]д/.test(t)) return 13 * 60;
  if (/evening|dinner|вечер/.test(t)) return 19 * 60 + 30;
  if (/night|нощ/.test(t)) return 21 * 60 + 30;
  return null;
}

/** Whether the venue is open on `date` at the item's scheduled time.
 *
 * Returns undefined — not false — whenever the question can't be answered:
 * no published hours, no parseable visit time, a malformed period list.
 * That distinction is the whole point. "We don't know" and "it's shut" look
 * identical to a naive check, and conflating them would delete perfectly
 * good venues (parks, viewpoints, and plenty of small businesses publish no
 * hours at all) to solve a problem they don't have. */
export function isOpenAt(place: PlacesApiPlace, date: string, time: string | undefined): boolean | undefined {
  const periods = place.regularOpeningHours?.periods;
  if (!periods || periods.length === 0) return undefined;

  const minutes = scheduledMinutes(time);
  if (minutes == null) return undefined;

  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return undefined;
  const weekday = new Date(parsed).getUTCDay(); // 0 = Sunday, same as Google
  const visit = weekMinute(weekday, Math.floor(minutes / 60), minutes % 60);

  // A single period with an open block and no close means "open 24 hours".
  if (periods.length === 1 && periods[0].open && !periods[0].close) return true;

  for (const period of periods) {
    const o = period.open;
    const c = period.close;
    if (!o || o.day == null || !c || c.day == null) continue;
    const start = weekMinute(o.day, o.hour ?? 0, o.minute ?? 0);
    let end = weekMinute(c.day, c.hour ?? 0, c.minute ?? 0);
    // Closing "before" opening means the period wraps past Saturday night
    // into Sunday morning — add a week so the comparison stays linear.
    if (end <= start) end += 7 * 24 * 60;
    if (visit >= start && visit < end) return true;
    // The same wrapped period also has to be tested one week earlier, or a
    // Sunday-morning visit inside a Saturday-night period is missed.
    if (visit + 7 * 24 * 60 >= start && visit + 7 * 24 * 60 < end) return true;
  }
  return false;
}

function applyPlaceData(item: ItineraryItem, place: PlacesApiPlace): void {
  // Only surface a rating we'd actually stand behind — see MIN_RATING_COUNT.
  if (hasReliableRating(place)) {
    item.google_rating = place.rating;
    item.google_rating_count = place.userRatingCount;
  }
  item.google_price_level = mapPriceLevel(place.priceLevel);
  item.google_business_status = mapBusinessStatus(place.businessStatus);
  if (place.id && place.displayName?.text) {
    item.google_maps_url = buildMapsUrl(place.displayName.text, place.id);
  }
}

/** Starts the geocode lookups for a trip's destinations before anything
 * needs them, and hands back the cache checkVenues will use.
 *
 * Every Places lookup awaits its city's geocode first — it's memoized, so
 * a trip pays one geocode per city rather than one per venue, but that one
 * still sat at the head of the verification stage with every lookup queued
 * behind it. The destinations are known the instant the job is read, so
 * this runs at t=0 alongside the flight lookup and the cache is warm by the
 * time verification starts.
 *
 * Failures are already handled downstream: a null geocode just skips the
 * distance cross-check for that city. */
export function prewarmGeocodes(destinations: string[]): Map<string, Promise<GeoPoint | null>> {
  const cache = new Map<string, Promise<GeoPoint | null>>();
  for (const city of destinations) {
    // Swallowed here as well as inside geocode(), so an unhandled rejection
    // can't escape a promise nobody is awaiting yet.
    void geocode(city, cache).catch(() => null);
  }
  return cache;
}

export interface CheckVenuesOptions {
  /** Verify only these items. Used for the second pass, which re-checks
   * just the venues the repair stage added or replaced — re-verifying the
   * whole trip would spend a Places lookup per item to confirm what the
   * first pass already confirmed. */
  only?: Set<ItineraryItem>;
  /** Downgrade a failed item to unnamed instead of deleting it.
   *
   * Used by the second pass, and it matters: the repairs exist to close
   * holes, and deleting a replacement that also fails verification would
   * reopen the exact hole the repair just closed — a day would lose its
   * dinner twice over, once to the original venue failing and once to its
   * replacement failing, with no third attempt coming.
   *
   * Keeping the item without its venue name is the honest middle: the
   * traveler still has a dinner in their evening, it just doesn't claim to
   * be a specific restaurant we stand behind. The gate reports it as a
   * generic venue, which is a warning worth seeing rather than a hole
   * nobody notices. */
  keepUnverified?: boolean;
  /** A cache pre-warmed by prewarmGeocodes, so the lookups don't have to
   * wait on a geocode round-trip that could have happened at job start. */
  geoCache?: Map<string, Promise<GeoPoint | null>>;
}

export async function checkVenues(
  itinerary: Itinerary,
  options: CheckVenuesOptions = {}
): Promise<Itinerary> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return itinerary;

  // Paired with its day, because the single most valuable thing this
  // function can check — is the place open when we're sending someone —
  // needs the date, and the previous flatMap threw it away.
  const targets = (itinerary.days ?? []).flatMap((day) =>
    day.items
      .filter((item) => isNamedVenueItem(item) && (!options.only || options.only.has(item)))
      .map((item) => ({ item, date: day.date }))
  );
  if (targets.length === 0) return itinerary;

  const toRemove = new Set<ItineraryItem>();
  const geoCache = options.geoCache ?? new Map<string, Promise<GeoPoint | null>>();
  let unavailable = 0;

  await Promise.all(
    targets.map(async ({ item, date }) => {
      // Safe: item is only in targets because isNamedVenueItem already
      // confirmed resolveVenueName(item) is non-null.
      const venueName = resolveVenueName(item)!;
      const bias = await geocode(item.location, geoCache);
      const lookup = await lookupPlace(apiKey, `${venueName}, ${item.location}`, bias);

      // Verifier down: leave the item untouched rather than deleting it.
      if (lookup.status === "unavailable") {
        unavailable++;
        return;
      }

      const place = lookup.status === "found" ? lookup.place : null;
      const placeName = place?.displayName?.text;
      const matched = place && placeName && namesLikelyMatch(venueName, placeName);

      // Lodging is downgraded to unnamed instead of dropped — see
      // isLodging/stripUnverifiedLodging for why removal isn't an option.
      const reject = (target: ItineraryItem) => {
        if (isLodging(target) || options.keepUnverified) stripUnverifiedLodging(target);
        else toRemove.add(target);
      };

      if (!place || !matched) {
        reject(item); // couldn't confirm this business exists at all
        return;
      }

      // Name matched, but a same/similarly-named venue can still exist
      // somewhere entirely wrong — the failure mode confirmed in practice
      // (a different city, once a different country). Reject on distance
      // regardless of how well the name matched.
      if (bias && place.location && distanceKm(bias, place.location) > MAX_MATCH_DISTANCE_KM) {
        reject(item);
        return;
      }

      applyPlaceData(item, place);

      // Open on the actual day and hour we're sending them. Checked after
      // applyPlaceData so the hours are recorded on the item either way —
      // a traveler seeing "closed Mondays" next to a venue understands the
      // plan; one seeing nothing just finds a locked door.
      const open = isOpenAt(place, date, item.time);
      item.google_open_on_visit = open;
      item.google_opening_hours = place.regularOpeningHours?.weekdayDescriptions;

      const status = item.google_business_status;
      if (status === "closed_permanently" || status === "closed_temporarily") {
        reject(item);
      } else if (open === false) {
        // A real, well-rated venue that happens to be shut that day. Same
        // outcome as any other failed check — it does not appear — but the
        // repair stage that runs after this pass will put a different real
        // venue in the slot, so the day doesn't just lose a meal.
        reject(item);
      } else if (
        hasReliableRating(place) &&
        place.rating! < minRatingFor(item) &&
        !(item.type === "activity" && (place.userRatingCount ?? 0) >= LANDMARK_RATING_COUNT)
      ) {
        // Only reject on a rating solid enough to justify it — a bad
        // average over a handful of reviews isn't evidence the place is bad
        // — and never on rating alone for a landmark (see
        // LANDMARK_RATING_COUNT).
        reject(item);
      }
    })
  );

  if (unavailable > 0) {
    // Loud on purpose. Silently shipping unverified venues is the right
    // call in the moment and the wrong thing to never find out about.
    console.warn(
      `[worker] Places was unavailable for ${unavailable}/${targets.length} venue(s) — ` +
        `those items ship unverified rather than being dropped`
    );
  }

  if (toRemove.size > 0) {
    for (const day of itinerary.days ?? []) {
      day.items = day.items.filter((item) => !toRemove.has(item));
    }
  }

  return itinerary;
}
