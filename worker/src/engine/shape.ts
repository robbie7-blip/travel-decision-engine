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
import { sourceUrlList, usableCostEur } from "./money";

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

/** What normalizeItineraryShape had to repair, if anything.
 *
 * Counted because today's fixes are all justified by shapes a model COULD
 * send, and a silent repair leaves that as an argument rather than a fact.
 * `normalizeLodgingPrices` already sets the precedent - it returns a count
 * and index.ts logs "corrected N accommodation item(s)" - and this is the
 * same question about a wider set of fields.
 *
 * A non-zero count on a real generation is the evidence that the guards
 * earn their keep. A zero count, run after run, is worth knowing too: it
 * says the model is well-behaved here and these are backstops rather than
 * live corrections. Either answer is better than not asking. */
export interface ShapeRepairs {
  /** Days given an items array they did not have. */
  days: number;
  /** Prices coerced to a usable number (or to 0). */
  prices: number;
  /** time/title/location/reasoning replaced with "". */
  strings: number;
  /** source_urls entries dropped, or a non-array replaced. */
  citations: number;
  /** venue_name set to null because it was not a usable string. */
  venueNames: number;
  /** min_realistic_total_eur recovered from text. */
  minimumEstimate: number;
}

export function newShapeRepairs(): ShapeRepairs {
  return { days: 0, prices: 0, strings: 0, citations: 0, venueNames: 0, minimumEstimate: 0 };
}

/** One line naming what was repaired, or null when nothing was. */
export function describeShapeRepairs(r: ShapeRepairs): string | null {
  const parts: string[] = [];
  if (r.days > 0) parts.push(`${r.days} day(s) with no items array`);
  if (r.prices > 0) parts.push(`${r.prices} price(s)`);
  if (r.strings > 0) parts.push(`${r.strings} text field(s)`);
  if (r.citations > 0) parts.push(`${r.citations} source_urls field(s)`);
  if (r.venueNames > 0) parts.push(`${r.venueNames} venue_name(s)`);
  if (r.minimumEstimate > 0) parts.push(`the minimum estimate`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Guarantees `days` and every `day.items` is an array, and every price a
 * number, in place.
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
export function normalizeItineraryShape(itinerary: Itinerary, repairs?: ShapeRepairs): Itinerary {
  // The model's own estimate of the floor, and the ONE model-written number
  // whose reader already guards it: ItineraryResult renders the line only
  // `Number.isFinite(min_realistic_total_eur)`. So it is RECOVERED when it
  // can be - "1200" puts the minimum-estimate line back on a paid itinerary
  // that would otherwise silently drop it - and left exactly as it is when
  // it cannot. Writing 0 here would be worse than leaving it broken: the
  // guard would pass and the page would state a minimum of EUR 0 as fact.
  if (itinerary.budget_feasibility && typeof itinerary.budget_feasibility === "object") {
    const current = itinerary.budget_feasibility.min_realistic_total_eur;
    const recovered = usableCostEur(current);
    if (recovered !== null && recovered !== current) {
      itinerary.budget_feasibility.min_realistic_total_eur = recovered;
      if (repairs) repairs.minimumEstimate++;
    }
  }

  if (!Array.isArray(itinerary.days)) {
    itinerary.days = [];
    return itinerary;
  }
  for (const day of itinerary.days) {
    if (!day || typeof day !== "object") continue;
    if (!Array.isArray(day.items)) {
      day.items = [];
      if (repairs) repairs.days++;
      continue;
    }
    // Every price, made a number, for the same reason the items array is
    // made an array: because everything downstream already believes it is
    // one. See money.ts for what `"20"` did to the trip total.
    //
    // Unusable becomes 0 rather than being left alone, which is the
    // opposite of the decision above, and the difference is who reads it.
    // Nothing guards `cost_estimate_eur` - it is summed, divided by party
    // size, compared against a nightly rate and printed - so leaving a
    // string there only moves the failure downstream. 0 is the value all of
    // those already handle, and it is the value prices_present already
    // calls a defect for a meal, a bed or a flight, so an unusable price
    // reports itself through machinery that exists rather than silently.
    for (const item of day.items) {
      if (!item || typeof item !== "object") continue;
      const price = usableCostEur(item.cost_estimate_eur) ?? 0;
      if (repairs && price !== item.cost_estimate_eur) repairs.prices++;
      item.cost_estimate_eur = price;
      // The citations, for the same reason and with sharper consequences.
      // deriveConfidenceTiers counts this field's `.length`, which on a
      // STRING is the character count - so one URL written as a bare string
      // instead of a one-element array measured 45, cleared the ">= 2"
      // test, and was stamped "verified", the tier that means two
      // independent sources agreed. See sourceUrlList.
      //
      // Set only when the field is present at all, so an item that never
      // claimed a source does not gain an empty array it did not have -
      // `?? []` is what every reader already does with absence.
      if (item.source_urls !== undefined) {
        const before = Array.isArray(item.source_urls) ? item.source_urls.length : -1;
        item.source_urls = sourceUrlList(item.source_urls);
        if (repairs && item.source_urls.length !== before) repairs.citations++;
      }

      // And the STRINGS, which is the one that discards a paid trip.
      //
      // `time`, `title`, `location` and `reasoning` are declared required
      // strings on ItineraryItem and arrive from `JSON.parse(text) as
      // ItineraryDay`. Measured, with `"time": 1300` - a model asked for a
      // clock time writing a number, which is about the most ordinary slip
      // available:
      //
      //   mealSlotOf   THREW: time.toLowerCase is not a function
      //   assessQuality THREW: time.toLowerCase is not a function
      //
      // The second one is the expensive one. The acceptance gate runs at the
      // very end, inside processJob's try and outside every retry, so its
      // throw marks the job "error" with "Unexpected error generating
      // itinerary" - for an itinerary that was fully generated and fully
      // paid for. That is word for word the failure assertUsableItinerary
      // was written for, on a different field.
      //
      // The same holds for `venue_name` (`.toLowerCase()` in four places
      // including the gate, `.trim()` in two more) and `location`
      // (`(item.location ?? "").toLowerCase()` in perNightRateFor, which
      // the gate and normalizeLodgingPrices both call, and `.split(",")` in
      // the geocoder).
      // Only where the field is PRESENT and the wrong type. Absence was
      // never the defect: every one of those readers guards falsiness, so
      // `undefined` returns null or "" or renders as nothing, while `1300`
      // throws. Coercing absence too would make this pass rewrite items
      // that had nothing wrong with them, which costs the one property that
      // makes it safe to run twice - and running it twice is exactly what
      // the repairs need.
      const fields = item as unknown as Record<string, unknown>;
      for (const key of ["time", "title", "location", "reasoning"]) {
        if (fixText(fields, key) && repairs) repairs.strings++;
      }
      // venue_name is `string | null`, and null is the value every reader
      // already treats as "this item names no business" - so an unusable one
      // becomes null rather than "", which would be a named venue with no
      // name and would keep the item in the verification pass.
      if (item.venue_name !== undefined) {
        const name = typeof item.venue_name === "string" && item.venue_name.trim() ? item.venue_name : null;
        if (repairs && name !== item.venue_name) repairs.venueNames++;
        item.venue_name = name;
      }
    }
  }
  return itinerary;
}

/** Replaces a present-but-not-a-string field with "", in place.
 *
 * "" rather than a placeholder: every reader of these fields either renders
 * them (where empty is empty) or matches on them (where empty matches
 * nothing), and both are behaviours that already exist. Inventing a value
 * would put words in the model's mouth on the traveller's page.
 *
 * Absent is left absent, deliberately - see the call sites. */
function fixText(item: Record<string, unknown>, key: string): boolean {
  if (key in item && typeof item[key] !== "string") {
    item[key] = "";
    return true;
  }
  return false;
}
