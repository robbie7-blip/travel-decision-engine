// THE BRIEF, MADE THE SHAPE processJob ALREADY BELIEVES IT IS.
//
// readJobRecord (jobs.ts) checks that `brief` is an object and stops there,
// with a comment saying so outright: "the worker re-reads it and
// parseTripBrief already owns that - this is the envelope, not the
// contents." Except parseTripBrief runs on the OTHER deployment, before
// enqueue, and the worker is the side that actually spends. Anything on the
// queue that a current /api/generate did not write - a record from an older
// build, a re-enqueued refinement, a hand-written entry - arrives here with
// `brief as TripBriefInput` asserted over it and nothing checked.
//
// Measured, by injecting brief shapes into the real processJob:
//
//   {}                              TypeError: destinations is not iterable
//   destinations: "Rome"            job.brief.destinations.join is not a function
//   destinations: [null, "Rome"]    Cannot read properties of null (reading 'split')
//   interests: "food"               brief.interests.join is not a function
//   must_see: null                  Cannot read properties of null (reading 'length')
//
// The first three throw BEFORE processJob's try, so nothing marks the job
// failed at all: the record sits at "pending" or "running" until
// stallReason times it out, and the traveler watches a spinner and is then
// told the server restarted. The last two throw INSIDE the try, which is
// the expensive shape - by then the itinerary may be generated and paid
// for, and the sentence they get is "Unexpected error generating
// itinerary."
//
// Every one of those is one wrong type on a list field. So this coerces
// rather than rejects, wherever coercing has an obvious right answer: a
// missing interests list is an empty one, a null in destinations is
// dropped, a string party size is read as a number. Only two things are
// actually fatal - no usable destination and no usable dates - because
// those decide what is generated and how many paid model calls it takes,
// and there is no honest default for either.
//
// Run: npm run test:brief-shape

import { parseCalendarDate } from "./jobs";
import type { Language, TripBriefInput } from "./types";

const MAX_LIST_ENTRIES = 40;
const MAX_LIST_ENTRY_CHARS = 200;

/** Only the values TripBriefInput declares. An unrecognised string is
 * dropped rather than passed through: these go straight into the prompt,
 * and every reader downstream switches on them. */
const PACES = new Set(["relaxed", "moderate", "packed"]);
const TRANSPORT_PREFERENCES = new Set(["public_transit", "taxi_rideshare", "walking"]);
const LANGUAGES = new Set(["en", "bg"]);

/** A list of non-empty strings, whatever arrived.
 *
 * Deliberately the same shape as the frontend's cleanList, with one
 * difference that matters: a non-array is an empty list here rather than a
 * rejection. parseTripBrief is answering a traveler filling in a form and
 * should tell them what is wrong; this is answering a record already on the
 * queue, where the alternative to "no interests" is throwing away a trip
 * over a field that only ever softens the prompt. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim().slice(0, MAX_LIST_ENTRY_CHARS))
    .filter(Boolean)
    .slice(0, MAX_LIST_ENTRIES);
}

/** A trimmed string, or undefined. Used for every optional free-text field,
 * so a number under `origin` becomes absence rather than reaching
 * `origin.trim()`. */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** A required string, or "" - which every reader already guards, because
 * the fields using it (start_date, party_composition) are checked for
 * falsiness all over the pipeline. */
function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A boolean that defaults to true, matching the field comments on
 * needs_lodging and needs_flight ("Defaults to true"). Only an explicit
 * `false` turns it off, so a missing or malformed value plans the trip the
 * fuller way rather than silently dropping every bed from it. */
function defaultTrue(value: unknown): boolean {
  return value !== false;
}

export interface BriefProblem {
  /** What could not be read, for the log and the failure record. */
  reason: string;
  /** What the traveler is told. Named, actionable, and never the
   * catch-all sentence. */
  travelerMessage: string;
}

export type BriefCheck =
  | { ok: true; brief: TripBriefInput; repaired: string[] }
  | { ok: false; problem: BriefProblem };

/** Coerces a queued brief into the shape the pipeline dereferences, or says
 * why it cannot.
 *
 * `repaired` names every field that was not already the declared type, so a
 * job that only worked because of this gate says so in the log instead of
 * looking like an ordinary run. */
export function checkBrief(value: unknown): BriefCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      problem: {
        reason: `brief is ${Array.isArray(value) ? "an array" : typeof value}, not an object`,
        travelerMessage: "This trip's details could not be read. Please start it again.",
      },
    };
  }
  const b = value as Record<string, unknown>;
  const repaired: string[] = [];
  const note = (field: string, was: unknown, now: unknown): void => {
    // Only when something actually changed. A field that was already right
    // must not show up in the log line, or the line stops meaning
    // anything.
    if (JSON.stringify(was) !== JSON.stringify(now)) repaired.push(field);
  };

  const destinations = stringList(b.destinations);
  if (destinations.length === 0) {
    return {
      ok: false,
      problem: {
        reason: `destinations is ${
          Array.isArray(b.destinations) ? `an array with nothing usable in it` : typeof b.destinations
        }`,
        travelerMessage: "No destination could be read from this trip. Please start it again with a city.",
      },
    };
  }
  note("destinations", b.destinations, destinations);

  const startDate = requiredString(b.start_date);
  const endDate = requiredString(b.end_date);
  if (!startDate || !endDate) {
    // Fatal, and not coerced to today's date. The dates decide the day
    // count, and the day count is one paid model call each - inventing
    // them would be inventing a bill.
    return {
      ok: false,
      problem: {
        reason: `start_date is ${typeof b.start_date}, end_date is ${typeof b.end_date}`,
        travelerMessage: "This trip has no dates on it. Please start it again and pick them.",
      },
    };
  }

  // And they have to be real calendar dates, in order.
  //
  // parseTripBrief checks both (see parseCalendarDate and the "end_date
  // must be on or after start_date" rejection); nothing did on this side,
  // and `start_date: "soon"` generated a complete trip. Measured through
  // processJob: briefSpanDays returns null for an unparseable pair, so the
  // day cap does not fire either, and the model is handed "soon" as a
  // date. What comes back is a full itinerary, fully paid for, with
  // nonsense on every day - which is worse than an error, because it
  // looks finished.
  //
  // Fatal rather than repaired, for the same reason as absence: there is
  // no honest guess at what "soon" meant.
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (!start || !end) {
    return {
      ok: false,
      problem: {
        reason: `dates are not calendar dates (start ${JSON.stringify(startDate)}, end ${JSON.stringify(endDate)})`,
        travelerMessage: "This trip's dates could not be read. Please start it again and pick them.",
      },
    };
  }
  if (end.getTime() < start.getTime()) {
    return {
      ok: false,
      problem: {
        reason: `end_date ${endDate} is before start_date ${startDate}`,
        travelerMessage: "This trip ends before it starts. Please start it again and pick the dates.",
      },
    };
  }
  note("start_date", b.start_date, startDate);
  note("end_date", b.end_date, endDate);

  const partySizeRaw = typeof b.party_size === "string" ? Number(b.party_size) : b.party_size;
  const partySize =
    typeof partySizeRaw === "number" && Number.isFinite(partySizeRaw) && partySizeRaw >= 1
      ? Math.trunc(partySizeRaw)
      : 1;
  note("party_size", b.party_size, partySize);

  // null is the declared "no budget stated" value and is left alone;
  // anything else unusable becomes null too, because a NaN budget is
  // compared against the itinerary total and printed on the page.
  const budgetRaw = typeof b.budget_total_eur === "string" ? Number(b.budget_total_eur) : b.budget_total_eur;
  const budget =
    typeof budgetRaw === "number" && Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
  note("budget_total_eur", b.budget_total_eur, budget);

  const pace = typeof b.pace === "string" && PACES.has(b.pace) ? (b.pace as TripBriefInput["pace"]) : "moderate";
  note("pace", b.pace, pace);

  const language = typeof b.language === "string" && LANGUAGES.has(b.language) ? (b.language as Language) : "en";
  note("language", b.language, language);

  const lists = {
    interests: stringList(b.interests),
    must_see: stringList(b.must_see),
    dietary_constraints: stringList(b.dietary_constraints),
    mobility_constraints: stringList(b.mobility_constraints),
    hard_no: stringList(b.hard_no),
  };
  for (const [field, now] of Object.entries(lists)) note(field, b[field], now);

  // visited_countries is the one list that is OPTIONAL on TripBriefInput,
  // and absence is meaningful: it is empty for every anonymous traveler,
  // and tripBriefToPromptBlock only mentions it when there is something to
  // mention. So an absent one stays absent rather than becoming `[]`,
  // which would otherwise show up in every repair log line on every
  // healthy job and make that line worth ignoring. Caught by this file's
  // own suite on the first run.
  const visitedCountries = stringList(b.visited_countries);
  if (b.visited_countries !== undefined && JSON.stringify(b.visited_countries) !== JSON.stringify(visitedCountries)) {
    repaired.push("visited_countries");
  }

  const partyComposition = requiredString(b.party_composition);
  note("party_composition", b.party_composition, partyComposition);

  const needsLodging = defaultTrue(b.needs_lodging);
  const needsFlight = defaultTrue(b.needs_flight);
  note("needs_lodging", b.needs_lodging, needsLodging);
  note("needs_flight", b.needs_flight, needsFlight);

  const optional = {
    origin: optionalString(b.origin),
    accommodation_location: optionalString(b.accommodation_location),
    arrival_date: optionalString(b.arrival_date),
    arrival_time: optionalString(b.arrival_time),
    arrival_airport: optionalString(b.arrival_airport),
    departure_date: optionalString(b.departure_date),
    departure_time: optionalString(b.departure_time),
    departure_airport: optionalString(b.departure_airport),
  };
  for (const [field, now] of Object.entries(optional)) {
    // undefined on both sides is not a repair, and JSON.stringify makes
    // both of those the string "undefined" - so compare directly here.
    if (b[field] !== now) repaired.push(field);
  }

  const transportPreference =
    typeof b.transport_preference === "string" && TRANSPORT_PREFERENCES.has(b.transport_preference)
      ? (b.transport_preference as TripBriefInput["transport_preference"])
      : undefined;
  if (b.transport_preference !== transportPreference) repaired.push("transport_preference");

  return {
    ok: true,
    repaired,
    brief: {
      destinations,
      start_date: startDate,
      end_date: endDate,
      party_size: partySize,
      party_composition: partyComposition,
      budget_total_eur: budget,
      pace,
      language,
      needs_lodging: needsLodging,
      needs_flight: needsFlight,
      transport_preference: transportPreference,
      ...lists,
      ...(visitedCountries.length > 0 ? { visited_countries: visitedCountries } : {}),
      ...optional,
    },
  };
}
