// Shared request-body validation for the two job-creating endpoints
// (/api/generate, /api/refine) — both ultimately need a validated
// TripBriefInput, so this is the one place that logic lives.

import type { TripBriefInput } from "./types";

export class ValidationError extends Error {}

const VALID_PACES = new Set(["relaxed", "moderate", "packed"]);
const VALID_LANGUAGES = new Set(["en", "bg"]);
const VALID_TRANSPORT_PREFERENCES = new Set(["public_transit", "taxi_rideshare", "walking"]);

function cleanList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array of strings`);
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
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

  if (typeof b.start_date !== "string" || !b.start_date.trim()) {
    throw new ValidationError("start_date is required.");
  }
  if (typeof b.end_date !== "string" || !b.end_date.trim()) {
    throw new ValidationError("end_date is required.");
  }

  const partySize = Number(b.party_size);
  if (!Number.isFinite(partySize) || partySize < 1) {
    throw new ValidationError("party_size must be a number >= 1.");
  }

  if (typeof b.party_composition !== "string" || !b.party_composition.trim()) {
    throw new ValidationError("party_composition is required.");
  }

  let budget: number | null = null;
  if (b.budget_total_eur !== null && b.budget_total_eur !== undefined && b.budget_total_eur !== "") {
    budget = Number(b.budget_total_eur);
    if (!Number.isFinite(budget) || budget < 0) {
      throw new ValidationError("budget_total_eur must be a non-negative number or null.");
    }
  }

  if (typeof b.pace !== "string" || !VALID_PACES.has(b.pace)) {
    throw new ValidationError(`pace must be one of ${[...VALID_PACES].sort().join(", ")}.`);
  }

  let origin: string | undefined;
  if (b.origin !== undefined && b.origin !== null) {
    if (typeof b.origin !== "string") {
      throw new ValidationError("origin must be a string.");
    }
    origin = b.origin.trim() || undefined;
  }

  const language = typeof b.language === "string" && VALID_LANGUAGES.has(b.language)
    ? (b.language as TripBriefInput["language"])
    : "en";

  const needs_lodging = b.needs_lodging === false ? false : true;
  const needs_flight = b.needs_flight === false ? false : true;

  let accommodation_location: string | undefined;
  if (b.accommodation_location !== undefined && b.accommodation_location !== null) {
    if (typeof b.accommodation_location !== "string") {
      throw new ValidationError("accommodation_location must be a string.");
    }
    accommodation_location = b.accommodation_location.trim() || undefined;
  }

  let transport_preference: TripBriefInput["transport_preference"];
  if (b.transport_preference !== undefined && b.transport_preference !== null && b.transport_preference !== "") {
    if (typeof b.transport_preference !== "string" || !VALID_TRANSPORT_PREFERENCES.has(b.transport_preference)) {
      throw new ValidationError(`transport_preference must be one of ${[...VALID_TRANSPORT_PREFERENCES].sort().join(", ")}.`);
    }
    transport_preference = b.transport_preference as TripBriefInput["transport_preference"];
  }

  let arrival_date: string | undefined;
  if (b.arrival_date !== undefined && b.arrival_date !== null) {
    if (typeof b.arrival_date !== "string") {
      throw new ValidationError("arrival_date must be a string.");
    }
    arrival_date = b.arrival_date.trim() || undefined;
  }

  let arrival_time: string | undefined;
  if (b.arrival_time !== undefined && b.arrival_time !== null) {
    if (typeof b.arrival_time !== "string") {
      throw new ValidationError("arrival_time must be a string.");
    }
    arrival_time = b.arrival_time.trim() || undefined;
  }

  // Pass-through only — this endpoint never trusts a client-supplied value
  // for anything cost/security-sensitive, and this field is neither: it's a
  // soft prompt-tone signal (see the comment on TripBriefInput in types.ts).
  // /api/generate overwrites it right after parsing with a fresh lookup
  // from the caller's own account anyway; the pass-through here exists so
  // /api/refine — which re-validates the client's *echoed* brief from a
  // previous /api/generate response rather than looking anything up itself —
  // doesn't silently lose personalization on every follow-up question.
  // Capped at 50 (nobody has visited more real countries than exist) purely
  // so a malformed/huge array can't bloat the prompt.
  const visitedCountries = cleanList(b.visited_countries, "visited_countries").slice(0, 50);

  return {
    destinations,
    origin,
    start_date: b.start_date.trim(),
    end_date: b.end_date.trim(),
    party_size: Math.trunc(partySize),
    party_composition: b.party_composition.trim(),
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
    ...(visitedCountries.length > 0 ? { visited_countries: visitedCountries } : {}),
  };
}
