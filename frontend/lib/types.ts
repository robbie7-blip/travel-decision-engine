// UI chrome language and generated-content language share one selector (see
// lib/i18n.ts for the UI dictionary, lib/engine/prompt.ts for how this drives
// the model's output language).
export type Language = "en" | "bg";

// Mirrors trip_brief.TripBrief (backend/../trip_brief.py) — the input contract.
export interface TripBriefInput {
  destinations: string[];
  // Departure city/location, optional — lets the engine estimate a real
  // arrival/departure transport cost instead of excluding it as unspecified
  // (previously observed leaving it out of the itinerary entirely).
  origin?: string;
  start_date: string;
  end_date: string;
  party_size: number;
  party_composition: string;
  budget_total_eur: number | null;
  pace: "relaxed" | "moderate" | "packed";
  interests: string[];
  // Specific non-negotiable inclusions (distinct from the broader `interests`
  // categories) — treated with the same seriousness as hard_no, but as
  // musts rather than avoids.
  must_see: string[];
  dietary_constraints: string[];
  mobility_constraints: string[];
  hard_no: string[];
  language: Language;
  // Defaults to true. Set false when the traveler already has accommodation
  // arranged (e.g. a business trip with lodging booked separately) — the
  // engine then excludes lodging line items and lodging cost from the
  // budget entirely instead of suggesting/pricing a place to stay.
  needs_lodging: boolean;
  // Only meaningful when needs_lodging is false — where the traveler is
  // actually staying (a hotel name, an address, a neighborhood), so the
  // engine can factor real proximity into sequencing (which sights are
  // closer, which metro/transit stations are convenient) without pricing
  // or suggesting lodging itself, which it already excludes entirely.
  accommodation_location?: string;
  // Defaults to true. Only meaningful when `origin` is set (that's the only
  // case the engine generates arrival/departure transport items at all) —
  // set false when the traveler already has a flight/train booked, and the
  // engine excludes those transport line items and their cost from the
  // budget entirely instead of pricing a trip they've already paid for.
  needs_flight: boolean;
  // Optional — how the traveler wants to get around locally (e.g. taxi/
  // rideshare over public transit for safety/convenience reasons). Absent
  // means no preference stated; the engine picks whatever's sensible.
  transport_preference?: "public_transit" | "taxi_rideshare" | "walking";
  // Only meaningful when needs_flight is false — the traveler's actual
  // arrival date (YYYY-MM-DD) and, optionally, a free-text time (e.g.
  // "20:00" or "evening"), so the engine doesn't presume day 1 must be a
  // light "just landed" day when it has no real booking info to base that
  // on. arrival_time alone (no arrival_date) is treated as referring to the
  // trip's start_date.
  arrival_date?: string;
  arrival_time?: string;
  // Country NAMES (not ISO codes — resolved from lib/countries.ts before
  // this ever reaches the worker, which has no country lookup of its own),
  // from the signed-in traveler's visited-countries tracker (see
  // lib/visited.ts). Set server-side in app/api/generate/route.ts from
  // their own account, NEVER from client input — parseTripBrief's explicit
  // allowlist already drops anything a client tried to pass under this key
  // before this field is populated. Absent/empty for anonymous travelers
  // (nothing to look up) — purely a soft personalization signal for the
  // model's tone/framing (see tripBriefToPromptBlock in prompt.ts), never
  // something that should override an explicit constraint or the budget.
  visited_countries?: string[];
}

// Mirrors the JSON schema in engine.py's SYSTEM_PROMPT — the output contract.
export interface BudgetFeasibility {
  feasible: boolean;
  min_realistic_total_eur: number;
  reasoning: string;
}

export interface KeyDecision {
  decision: string;
  reasoning: string;
  alternative_considered?: string;
  confidence: "high" | "medium" | "low";
}

export type ItemType = "transport" | "lodging" | "activity" | "meal";
export type SourceConfidence = "grounded" | "inferred";
export type SourceAgreement = "agree" | "disagree";

export interface ItineraryItem {
  time: string;
  type: ItemType;
  title: string;
  // Structured, language-independent signals the model sets directly —
  // titles follow the trip's response language (see prompt.ts's Response
  // language instruction), so flightLinks.ts/venueVerification.ts can't
  // reliably detect "is this a flight" / "does this name a venue" by
  // regex-matching English words in a title that might be in Bulgarian.
  // Optional because older cached itineraries predate these fields.
  is_flight?: boolean;
  venue_name?: string | null;
  location: string;
  cost_estimate_eur: number;
  reasoning: string;
  source_confidence: SourceConfidence;
  // Populated by the worker when live web search backs this item (see
  // SEARCH_INSTRUCTIONS in worker/src/index.ts) — the model writes the real
  // URL(s) it used directly into this field. Deliberately not relying on the
  // Anthropic API's automatic citation feature: that splits prose into
  // multiple text blocks around each citation, which would fragment our
  // forced-JSON output. 0-2 entries: 2 when the model cross-checked two
  // independent searches, 1 for a single usable result, absent/empty otherwise.
  source_urls?: string[];
  // Set only when two cross-check searches produced meaningfully conflicting
  // price info — the reasoning text explains the discrepancy explicitly
  // rather than silently picking one number. Null/absent for single-source
  // or ungrounded items.
  source_agreement?: SourceAgreement | null;
  // Derived by checkBudgetIntegrity's confidence-tier pass (worker/src/engine/
  // checks.ts) from source_urls/source_agreement above — NOT self-reported by
  // the model, on the same "verify structurally, don't trust the self-report"
  // principle as the budget-integrity check itself.
  confidence_tier?: ConfidenceTier;
  // Populated by checkVenues (worker/src/engine/venueVerification.ts) via a
  // real Google Places lookup — never self-reported by the model, same
  // "verify structurally" principle. Absent when GOOGLE_PLACES_API_KEY isn't
  // configured, the item isn't a named-venue meal/activity, or the lookup
  // found no confident match.
  google_rating?: number;
  google_rating_count?: number;
  google_price_level?: GooglePriceLevel;
  google_business_status?: GoogleBusinessStatus;
  // A real, verified Google Maps link built from the matched place's actual
  // ID — not a search-by-name guess, so it always resolves to the exact
  // place Google Places matched (or doesn't appear at all, rather than
  // linking somewhere that might not be the right result).
  google_maps_url?: string;
  // Whether the venue is actually OPEN on the day and at the hour this item
  // is scheduled for, checked against Google's real weekly opening hours.
  //
  // This is the difference between "this restaurant exists and is rated
  // 4.6" and "this restaurant is open when we are sending you there", and
  // it is the error a traveler cannot recover from: they trusted the plan,
  // walked across a city, and found a locked door. Every other verification
  // signal in this file is about whether a place is worth going to; this is
  // the only one about whether going is possible.
  //
  // Undefined when Google publishes no hours for the venue (common for
  // parks, viewpoints and some small businesses) or when the item has no
  // parseable time — absence of hours is not evidence of being closed, so
  // it is never treated as a failure.
  google_open_on_visit?: boolean;
  // Google's own human-readable weekly hours, carried through so the trip
  // page can show WHY something was flagged rather than just asserting it.
  google_opening_hours?: string[];
  /** How long the venue stays open after the scheduled arrival. "Open at
   * 15:30" and "worth going at 15:30" are different questions — a paid
   * attraction reached an hour before closing is technically open and
   * practically a wasted ticket, and most have a last-entry cutoff earlier
   * still. Undefined when there are no published hours, no parseable time,
   * or the place is open around the clock. */
  google_minutes_until_close?: number;
  // Populated by attachFlightSearchLinks (worker/src/engine/flightLinks.ts)
  // for arrival/departure transport items that are actual flights — a
  // Google Flights deep link for that exact route/date, built deterministically
  // from the trip brief rather than depending on whether the model's own
  // search happened to surface a usable source_url. Not a live-priced quote
  // (Google Flights runs its own fresh search when opened), but a real,
  // always-present place to check today's actual price.
  flight_search_url?: string;
  // Set by attachFlightPrices when the provider has price history for this
  // route — see FarePriceContext.
  fare_price_context?: FarePriceContext;
}

/** Where a live-checked fare sits against that route's own historical price
 * distribution — the honest version of "should I buy now?". Deliberately
 * NOT a prediction: it reports where today's number falls in a range that
 * actually happened, and says nothing about where it goes next. Absent
 * whenever the provider has no history for the route (thin routes often
 * have none), which is the correct outcome rather than a guess. */
export type FarePriceLevel = "low" | "typical" | "high";

export interface FarePriceContext {
  level: FarePriceLevel;
  /** First and third quartile for this route/date, EUR — the band a fare
   * has to fall outside of to count as notably cheap or notably dear. */
  typicalLowEur: number;
  typicalHighEur: number;
}

export type GooglePriceLevel = "free" | "inexpensive" | "moderate" | "expensive" | "very_expensive";
export type GoogleBusinessStatus = "operational" | "closed_temporarily" | "closed_permanently";

// "fact_grounded" is for items grounded in the curated facts/*.json base
// (source_confidence: "grounded", no live search — most non-lodging items)
// — distinct from the live-search tiers below, and NOT the same as
// "inferred": it's still checked data, just not cross-checked via search.
export type ConfidenceTier =
  | "verified"
  | "fact_grounded"
  | "single_source"
  | "conflicting"
  | "inferred";

export interface ItineraryDay {
  day: number;
  date: string;
  items: ItineraryItem[];
  feasibility_flag: string | null;
}

export interface SkipItem {
  item: string;
  reasoning: string;
}

export interface Itinerary {
  budget_feasibility: BudgetFeasibility;
  trip_summary: string;
  key_decisions: KeyDecision[];
  days: ItineraryDay[];
  things_to_skip: SkipItem[];
  // Only present when this itinerary is the result of a pushback/follow-up
  // refinement request (see buildRefinementPrompt in engine/prompt.ts) — the
  // model's direct answer to the traveler's question, shown above the
  // (possibly revised) itinerary rather than buried in trip_summary.
  pushback_response?: string;
}
