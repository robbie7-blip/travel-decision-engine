// Shared types for flight-history import - the traveler pastes a booking
// confirmation and gets their own past flights back, which then fill in the
// visited-countries tracker (see lib/visited.ts) instead of them ticking
// countries off by hand.
//
// Deliberately the traveler's OWN history and nobody else's. There is no
// global by-name flight lookup and there shouldn't be: that would be
// location history on a non-consenting person, unlawful under GDPR with no
// available basis, and a stalking tool regardless of intent. Forwarding
// your own confirmation IS the consent, which is what makes this version
// both legal and useful.
//
// Extraction is a model call rather than per-airline parsers on purpose.
// Confirmation emails vary by carrier, by OTA, by language and by decade,
// and a regex-per-format approach is a treadmill that never ends. What
// isn't left to the model: the country codes it returns are validated
// against lib/countries.ts before anything is written, so a hallucinated
// code is dropped rather than silently marking a country visited.

export interface ImportedFlight {
  /** IATA code where the leg lands, e.g. "RMO". */
  arrivalIata: string;
  /** Human-readable arrival city, for the confirmation UI. */
  arrivalCity: string;
  /** ISO 3166-1 alpha-2 for the arrival country, validated server-side. */
  arrivalCountryCode: string;
  departureIata: string;
  departureCity: string;
  /** YYYY-MM-DD. */
  date: string;
  airline?: string;
  flightNumber?: string;
  /** False for a booking that hasn't happened yet. A future flight is a
   * plan, not a visit, so it's shown but never pre-selected - otherwise a
   * forwarded upcoming booking would quietly mark a country visited. */
  isPast: boolean;
}

export interface FlightImportResult {
  flights: ImportedFlight[];
  /** Countries the past flights land in, deduped, ready to merge. */
  countryCodes: string[];
}

/** Confirmation emails are long once quoted headers and HTML-to-text noise
 * are included, but not unbounded - this caps worst-case token cost per
 * paste while comfortably fitting a normal multi-leg itinerary. */
export const MAX_FLIGHT_IMPORT_CHARS = 20000;

/** Below this there's nothing to extract and it's almost certainly a
 * mis-paste; rejecting it early avoids spending a model call to find out. */
export const MIN_FLIGHT_IMPORT_CHARS = 40;

// ---------------------------------------------------------------------------
// Reading the model's extraction
//
// This lived in app/api/flight-import/route.ts as `toImportedFlights`, where
// it could not be tested - no route handler in this app can be driven without
// standing up Next's request plumbing. It is the function that decides what a
// traveller's own history says, so it belongs somewhere a test can reach.
//
// Measured against the version it replaces, with the real countries table:
//
//   {"flights": [null]}                    THREW "Cannot read properties of
//                                          null" - and the route's catch
//                                          turns any throw into "Couldn't
//                                          read that confirmation. Try
//                                          pasting the full email text",
//                                          which blames the traveller's
//                                          email for a fault of ours. That
//                                          is the exact thing the comment on
//                                          that catch was written to stop it
//                                          doing, one function away.
//   {"date": "9999-99-99"}                 accepted. The check was
//                                          /^\d{4}-\d{2}-\d{2}$/, which is a
//                                          shape, not a date.
//   {"date": "2026-02-30"}                 accepted, and marked as a past
//                                          visit. February 30th.
//   {"date": "1800-01-01"}                 accepted as a flight in 1800.
//   {"arrival_iata": "the airport in
//    Chisinau"}                            accepted, uppercased, and shown
//                                          to the traveller as an IATA code.
//
// The date fix is not new code: parseCalendarDate in jobs.ts already rejects
// an impossible day and has done all along ("2026-02-30 would otherwise
// silently become March 2", says its own comment). This route open-coded a
// weaker regex beside it.

import { parseCalendarDate } from "./jobs";
import { getCountry } from "./countries";

/** An IATA airport code: exactly three letters. Checked because the code is
 * shown to the traveller AS a code and read back as one - anything else in
 * that field is the model answering a different question. */
const IATA_RE = /^[A-Z]{3}$/;

/** The oldest flight worth believing. Not a guess at the traveller's age: a
 * confirmation email old enough to predate this is not an email, and a
 * four-digit year that parses as 1800 is a model slip rather than a
 * memory. */
const EARLIEST_YEAR = 1950;

/** How far ahead a real booking can sit. Airlines sell roughly a year out,
 * occasionally eighteen months; three is generous on purpose, because
 * refusing a real future booking is worse than accepting an implausible
 * one - a future flight is shown but never counted as a visit anyway. */
const FUTURE_YEARS = 3;

/** Cap on a free-text field that reaches the screen. */
const MAX_CITY_CHARS = 80;

/** Cap on legs from one paste. MAX_TOKENS already bounds this in practice;
 * an explicit number means the bound does not depend on a model's output
 * length staying what it is today. */
const MAX_FLIGHTS = 40;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The flights we are willing to act on.
 *
 * Every rejection is a `continue` rather than a throw: one unreadable leg in
 * a six-leg booking should cost that leg, not the import. The country code is
 * checked against the real country list rather than trusted, because a
 * hallucinated code would mark a country visited that the traveller has never
 * been to - the one error this feature absolutely must not make. */
export function readImportedFlights(raw: unknown, now: Date = new Date()): ImportedFlight[] {
  const container = raw && typeof raw === "object" ? (raw as { flights?: unknown }) : null;
  const list = Array.isArray(container?.flights) ? container.flights : [];
  const today = now.toISOString().slice(0, 10);
  const earliest = EARLIEST_YEAR;
  const latest = now.getUTCFullYear() + FUTURE_YEARS;
  const out: ImportedFlight[] = [];

  for (const entry of list) {
    // A null entry used to throw here and lose the whole import.
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const f = entry as Record<string, unknown>;

    const arrivalCountryCode = str(f.arrival_country_code).toUpperCase();
    if (!arrivalCountryCode || !getCountry(arrivalCountryCode)) continue;

    const arrivalIata = str(f.arrival_iata).toUpperCase();
    if (!IATA_RE.test(arrivalIata)) continue;

    // A real calendar date, in a year a flight could have happened in.
    const date = str(f.date);
    const parsed = parseCalendarDate(date);
    if (!parsed) continue;
    const year = parsed.getUTCFullYear();
    if (year < earliest || year > latest) continue;

    // Optional, so an unusable one is dropped rather than dropping the leg.
    const departureIata = str(f.departure_iata).toUpperCase();

    out.push({
      arrivalIata,
      arrivalCity: str(f.arrival_city).slice(0, MAX_CITY_CHARS) || arrivalIata,
      arrivalCountryCode,
      departureIata: IATA_RE.test(departureIata) ? departureIata : "",
      departureCity: str(f.departure_city).slice(0, MAX_CITY_CHARS),
      date,
      airline: str(f.airline).slice(0, MAX_CITY_CHARS) || undefined,
      flightNumber: str(f.flight_number).slice(0, MAX_CITY_CHARS) || undefined,
      // Both sides are validated YYYY-MM-DD by now, which is the one format
      // where a string comparison IS a date comparison.
      isPast: date <= today,
    });
    if (out.length >= MAX_FLIGHTS) break;
  }
  return out;
}
