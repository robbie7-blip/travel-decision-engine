// Shared request-body validation for the two job-creating endpoints
// (/api/generate, /api/refine) - both ultimately need a validated
// TripBriefInput, so this is the one place that logic lives.

import type { TripBriefInput } from "./types";
// The trip-length cap lives in the jobs.ts mirrors, not here, because the
// worker enforces the same number before its first model call - it takes
// whatever is on the queue and is the side that actually spends. See the
// "Trip length" section there; check:stats-keys holds the two copies equal.
import { MAX_TRIP_DAYS, parseCalendarDate, tripDayCount } from "./jobs";

export { MAX_TRIP_DAYS, tripDayCount };

export class ValidationError extends Error {}

const VALID_PACES = new Set(["relaxed", "moderate", "packed"]);
const VALID_LANGUAGES = new Set(["en", "bg"]);
const VALID_TRANSPORT_PREFERENCES = new Set(["public_transit", "taxi_rideshare", "walking"]);

/** Cap on a single free-text list entry, in characters.
 *
 * Every one of these lists is interpolated into the model prompt. Without a
 * per-entry cap the array-length caps below are decoration: 50 entries of a
 * megabyte each is the same prompt-bloat (and the same injection surface) as
 * 50,000 short ones, at a fraction of the request size. Long enough that no
 * real interest, dietary note or must-see is ever truncated. */
const MAX_LIST_ENTRY_CHARS = 200;

/** Cap on entries per free-text list. */
const MAX_LIST_ENTRIES = 50;

/** Cap on a single free-text scalar field, in characters. Same reasoning as
 * MAX_LIST_ENTRY_CHARS: these are prompt inputs, and origin /
 * party_composition / accommodation_location were length-unbounded. Roomier
 * than a list entry because "two adults and a six-year-old who naps after
 * lunch" is a legitimate party_composition. */
const MAX_TEXT_CHARS = 400;

/** The largest party this endpoint will accept. Not a cost multiplier the
 * way days and cities are - it doesn't fan out into more calls - but an
 * unbounded integer reaches the prompt verbatim, and a group of 10^9 is not
 * a trip brief. */
const MAX_PARTY_SIZE = 50;

/** Upper bound on a stated trip budget, in EUR. Ten million is far past any
 * real brief and still a number the page can render. */
const MAX_BUDGET_EUR = 10_000_000;

/** Trims an optional free-text field to a bounded string, or undefined. */
function cleanText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string.`);
  return value.trim().slice(0, MAX_TEXT_CHARS) || undefined;
}

function cleanList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array of strings`);
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim().slice(0, MAX_LIST_ENTRY_CHARS))
    .filter(Boolean)
    .slice(0, MAX_LIST_ENTRIES);
}

export function parseTripBrief(body: unknown): TripBriefInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("brief must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  const destinations = cleanList(b.destinations, "destinations");
  if (destinations.length === 0) {
    throw new ValidationError("destinations must include at least one city.");
  }
  // Cities are the other multiplier on a job's cost: the lodging prefetch
  // and the venue-verification passes both fan out per city, independently
  // of the day cap below. You cannot spend a night in more cities than the
  // trip has days, so that's the ceiling.
  if (destinations.length > MAX_TRIP_DAYS) {
    throw new ValidationError(`A trip can include at most ${MAX_TRIP_DAYS} cities.`);
  }

  if (typeof b.start_date !== "string" || !b.start_date.trim()) {
    throw new ValidationError("start_date is required.");
  }
  if (typeof b.end_date !== "string" || !b.end_date.trim()) {
    throw new ValidationError("end_date is required.");
  }

  // Shape, order, and length - in that sequence, so the message names the
  // first thing actually wrong. All three were previously unchecked: the
  // strings went into the job record as typed and the worker derived the
  // day count (and therefore the number of paid model calls) from them.
  const startDate = b.start_date.trim();
  const endDate = b.end_date.trim();
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (!start) {
    throw new ValidationError("start_date must be a calendar date in YYYY-MM-DD form.");
  }
  if (!end) {
    throw new ValidationError("end_date must be a calendar date in YYYY-MM-DD form.");
  }
  if (end.getTime() < start.getTime()) {
    throw new ValidationError("end_date must be on or after start_date.");
  }
  // tripDayCount over the already-parsed pair, so the number this rejects
  // on is the same one the worker's own cap computes.
  const dayCount = tripDayCount(startDate, endDate) ?? 0;
  if (dayCount > MAX_TRIP_DAYS) {
    throw new ValidationError(
      `Trips are limited to ${MAX_TRIP_DAYS} days - this one is ${dayCount}. Please split it into shorter stretches.`
    );
  }

  const partySize = Number(b.party_size);
  if (!Number.isFinite(partySize) || partySize < 1) {
    throw new ValidationError("party_size must be a number >= 1.");
  }
  if (partySize > MAX_PARTY_SIZE) {
    throw new ValidationError(`party_size must be ${MAX_PARTY_SIZE} or fewer.`);
  }

  if (typeof b.party_composition !== "string" || !b.party_composition.trim()) {
    throw new ValidationError("party_composition is required.");
  }
  const partyComposition = b.party_composition.trim().slice(0, MAX_TEXT_CHARS);

  let budget: number | null = null;
  if (b.budget_total_eur !== null && b.budget_total_eur !== undefined && b.budget_total_eur !== "") {
    budget = Number(b.budget_total_eur);
    if (!Number.isFinite(budget) || budget < 0) {
      throw new ValidationError("budget_total_eur must be a non-negative number or null.");
    }
    // isFinite already rejects Infinity and NaN, but not 1e300 - which the
    // prompt would carry verbatim and the result page would render as
    // "€1e+300". An upper bound keeps the number a number.
    if (budget > MAX_BUDGET_EUR) {
      throw new ValidationError(`budget_total_eur must be ${MAX_BUDGET_EUR} or less.`);
    }
  }

  if (typeof b.pace !== "string" || !VALID_PACES.has(b.pace)) {
    throw new ValidationError(`pace must be one of ${[...VALID_PACES].sort().join(", ")}.`);
  }

  const origin = cleanText(b.origin, "origin");

  const language = typeof b.language === "string" && VALID_LANGUAGES.has(b.language)
    ? (b.language as TripBriefInput["language"])
    : "en";

  const needs_lodging = b.needs_lodging === false ? false : true;
  const needs_flight = b.needs_flight === false ? false : true;

  const accommodation_location = cleanText(b.accommodation_location, "accommodation_location");

  let transport_preference: TripBriefInput["transport_preference"];
  if (b.transport_preference !== undefined && b.transport_preference !== null && b.transport_preference !== "") {
    if (typeof b.transport_preference !== "string" || !VALID_TRANSPORT_PREFERENCES.has(b.transport_preference)) {
      throw new ValidationError(`transport_preference must be one of ${[...VALID_TRANSPORT_PREFERENCES].sort().join(", ")}.`);
    }
    transport_preference = b.transport_preference as TripBriefInput["transport_preference"];
  }

  const arrival_date = cleanText(b.arrival_date, "arrival_date");
  // Same shape check as the trip dates. This one reaches the prompt as the
  // day the traveler lands, and the worker schedules the first day around
  // it - an unparseable value there is a wrong itinerary, not a rejected
  // request, so it's worth failing loudly at the door.
  if (arrival_date && !parseCalendarDate(arrival_date)) {
    throw new ValidationError("arrival_date must be a calendar date in YYYY-MM-DD form.");
  }

  const departure_date = cleanText(b.departure_date, "departure_date");
  if (departure_date && !parseCalendarDate(departure_date)) {
    throw new ValidationError("departure_date must be a calendar date in YYYY-MM-DD form.");
  }

  // Deliberately NOT shape-checked the way arrival_date is. The form's own
  // placeholder invites free text here ("e.g. 8pm, or 'evening'"), and the
  // prompt passes it through as "around <whatever they said>" - the model
  // reads it, no code parses it. The length cap from cleanText is the whole
  // guard this field needs.
  const arrival_time = cleanText(b.arrival_time, "arrival_time");
  // Free text for the same reason as arrival_time - the form invites
  // "6am" or "late evening", and the prompt hands it to the model to read.
  const departure_time = cleanText(b.departure_time, "departure_time");

  // Pass-through only - this endpoint never trusts a client-supplied value
  // for anything cost/security-sensitive, and this field is neither: it's a
  // soft prompt-tone signal (see the comment on TripBriefInput in types.ts).
  // /api/generate overwrites it right after parsing with a fresh lookup
  // from the caller's own account anyway; the pass-through here exists so
  // /api/refine - which re-validates the client's *echoed* brief from a
  // previous /api/generate response rather than looking anything up itself -
  // doesn't silently lose personalization on every follow-up question.
  // cleanList already caps both the number of entries and the length of
  // each one (see MAX_LIST_ENTRIES / MAX_LIST_ENTRY_CHARS) - nobody has
  // visited more real countries than exist, and no country's name is 200
  // characters - so a malformed or huge array can't bloat the prompt.
  const visitedCountries = cleanList(b.visited_countries, "visited_countries");

  return {
    destinations,
    origin,
    start_date: startDate,
    end_date: endDate,
    party_size: Math.trunc(partySize),
    party_composition: partyComposition,
    budget_total_eur: budget,
    pace: b.pace as TripBriefInput["pace"],
    interests: cleanList(b.interests, "interests"),
    must_see: cleanList(b.must_see, "must_see"),
    dietary_constraints: cleanList(b.dietary_constraints, "dietary_constraints"),
    mobility_constraints: cleanList(b.mobility_constraints, "mobility_constraints"),
    hard_no: cleanList(b.hard_no, "hard_no"),
    language,
    needs_lodging,
    accommodation_location,
    needs_flight,
    transport_preference,
    arrival_date,
    arrival_time,
    departure_date,
    departure_time,
    ...(visitedCountries.length > 0 ? { visited_countries: visitedCountries } : {}),
  };
}
