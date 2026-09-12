// Is this thing actually an itinerary?
//
// Worker-only, and deliberately not part of checks.ts or quality.ts. Those
// two ask whether an itinerary is GOOD - whether the budget adds up, whether
// every night has a bed, whether a venue is open when we send someone
// there. Neither can run at all on an object that is the wrong SHAPE, and
// both of them dereference `days` and `items` on the assumption that
// something upstream already checked. For the single-call path, nothing had.
//
// Run: npm run test:shape

import type { Itinerary } from "../types";

/** Thrown for a response that parsed as JSON but is not an itinerary.
 *
 * Named the same as the worker's own ModelOutputError and carrying the same
 * meaning on purpose: index.ts re-throws it as one, and that is the error
 * withOneRetryOf retries. The distinction matters - malformed model output
 * is non-deterministic, so one retry usually succeeds, whereas a bug in our
 * own code would fail identically twice. */
export class ItineraryShapeError extends Error {}

/** Throws unless `value` is an itinerary in the shape everything downstream
 * dereferences without asking.
 *
 * The two-phase path already validates each day's items array as it comes
 * back (see generateDay). The single-call fallback - and every refinement -
 * did `JSON.parse(text) as Itinerary` and returned it, which is a type
 * assertion: it tells the compiler what to believe and verifies nothing at
 * runtime.
 *
 * What that cost. A response that parses but is missing `days`, or carries
 * one day with no `items` array, reached normalizeLodgingPrices, which
 * iterates both. That throws inside processJob's try, so a FULLY GENERATED,
 * fully paid itinerary was discarded and the traveler got "Unexpected error
 * generating itinerary" - the most expensive failure in the pipeline,
 * caused by one missing field. And since nothing detected it, the retry
 * that wraps both call sites never fired.
 *
 * Checks only what is dereferenced unguarded. This is not schema
 * validation: an itinerary that is merely POOR is what the repairs and the
 * acceptance gate are for, and they need it to be the right shape first. */
export function assertUsableItinerary(value: unknown): asserts value is Itinerary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ItineraryShapeError("Model returned JSON that is not an itinerary object.");
  }
  const it = value as Partial<Itinerary>;

  if (!Array.isArray(it.days)) {
    throw new ItineraryShapeError("Model returned an itinerary with no days array.");
  }
  // An empty days array is not a trip. It would render as a cover, a budget
  // line and nothing else, and read as a finished itinerary.
  if (it.days.length === 0) {
    throw new ItineraryShapeError("Model returned an itinerary with zero days.");
  }

  for (const day of it.days) {
    if (typeof day !== "object" || day === null) {
      throw new ItineraryShapeError("Model returned an itinerary with a day that is not an object.");
    }
    // The field the render path walked without a guard, in five places -
    // including computeTrustScore, which runs before a single row is drawn.
    if (!Array.isArray(day.items)) {
      throw new ItineraryShapeError(`Model returned day ${day.day ?? "?"} with no items array.`);
    }
  }

  // Drives the feasibility stamp, the minimum-estimate line, and the
  // budget-integrity correction. Every reader on the page guards it, so its
  // absence is survivable there - but not worth accepting in silence from a
  // call whose whole job is to produce a costed trip.
  if (typeof it.budget_feasibility !== "object" || it.budget_feasibility === null) {
    throw new ItineraryShapeError("Model returned an itinerary with no budget_feasibility.");
  }
}

/** Guarantees `days` and every `day.items` is an array, in place.
 *
 * assertUsableItinerary above THROWS on a missing items array, which is
 * right for a fresh model response - but it runs in exactly one place, the
 * single-call path. Everything downstream of generation then walks
 * `day.items` unguarded in 28 places across quality.ts, checks.ts,
 * venueVerification.ts, flightPricing.ts and index.ts itself, and the
 * reason that is safe today is three separate mechanisms in three separate
 * files: the single-call path asserts, generateDay validates
 * `Array.isArray(parsed?.items)` per day, and assembleItinerary builds days
 * only from those validated results.
 *
 * Three independent guarantees, no single place saying so, and 28
 * dereferences relying on all three holding forever. This exact class has
 * already cost this codebase twice: the calendar download threw on a day
 * with no items while the page rendered it fine ("`days` is guarded here
 * and `items` was not"), and normalizeLodgingPrices threw inside
 * processJob's try and discarded a fully generated, fully paid itinerary as
 * "Unexpected error" - which is what assertUsableItinerary was written for.
 *
 * So the shape is established ONCE, where the itinerary enters the
 * consuming stage, instead of being asserted in one path and assumed in the
 * rest. Repair rather than rejection, deliberately: by this point the trip
 * has been generated and paid for, and an empty day is a visible gap the
 * quality gate already reports (day_not_empty), where a throw here loses
 * the whole itinerary. That is the same trade normalizePlan makes.
 *
 * Idempotent, and it never touches a day that already has an array. */
export function normalizeItineraryShape(itinerary: Itinerary): Itinerary {
  if (!Array.isArray(itinerary.days)) {
    itinerary.days = [];
    return itinerary;
  }
  for (const day of itinerary.days) {
    if (day && typeof day === "object" && !Array.isArray(day.items)) {
      day.items = [];
    }
  }
  return itinerary;
}
