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
