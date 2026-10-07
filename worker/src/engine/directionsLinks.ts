// Attaches a real Google Maps directions link to every ground transport
// leg - the metro ride, the taxi, the walk between two areas.
//
// This is flightLinks.ts applied to the legs it does not cover, and for the
// same reason. A transport item has no business to look up, so Places can
// never verify it: isNamedVenueItem (venueVerification.ts) only considers
// meals, activities and lodging. Until this existed, every ground leg in
// every trip was counted as unverified by both the acceptance gate's
// groundedRatio and the traveler-facing trust score - not because anything
// was doubtful about it, but because there was no mechanism by which it
// could ever be confirmed.
//
// Measured on a real trip the owner was unhappy with: 47% of line items
// were "backed by anything checked". A typical day carries two or three of
// these legs out of nine or ten items, all of them structurally incapable
// of counting, while the day prompt asks for them in as many words
// ("getting between places", "ACCOUNT FOR THE WHOLE DAY"). The product was
// instructing the model to write lines it would then mark as unverified.
//
// A directions URL is the same kind of evidence as a Google Flights URL: a
// real, checkable link built deterministically from the route, not a
// claim. It costs no model call and no generation time, which is the whole
// reason it is the first thing worth doing about that number.
//
// LANGUAGE-INDEPENDENT, like flightLinks.ts and for the bug that file
// documents. The obvious implementation reads the leg's own location
// ("Fiumicino to Rome") and splits it on " to " - which silently never
// matches on a Bulgarian trip, where the same field reads "от Фиумичино
// до Рим", so no Bulgarian trip would ever get a link. So the endpoints
// are taken from the items either side of the leg instead: structure the
// trip has in every language.

import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "../types";

/** How the traveler said they want to get around, as Google Maps spells
 * it. Omitted when they did not say, so Maps picks for itself rather than
 * having this file guess on their behalf. */
const TRAVEL_MODE: Record<NonNullable<TripBriefInput["transport_preference"]>, string> = {
  public_transit: "transit",
  taxi_rideshare: "driving",
  walking: "walking",
};

/** How an item should be named to Google Maps, or null if it is not
 * somewhere a person can be dropped off.
 *
 * Transport is excluded, and that is the load-bearing line. `location` is
 * a REQUIRED string on every item, so a leg always has one - and a leg's
 * location describes the journey ("Fiumicino", "Rome to Ubud"), not a
 * place at the end of it. Without this, two legs in a row (a walk to the
 * metro, then the metro - an ordinary day) would route the first one to
 * the second one's description instead of to where the traveler is
 * actually going.
 *
 * The venue name alone is ambiguous ("Pantheon" is in Rome and in Paris)
 * and the location alone is vague ("Centro Storico"), so both go in when
 * both exist - which is also how the day prompt writes the field
 * ("Centro Storico, Rome"). */
function placeLabel(item: ItineraryItem): string | null {
  if (item.type === "transport") return null;
  const venue = item.venue_name?.trim();
  const location = item.location?.trim();
  if (venue && location) return `${venue}, ${location}`;
  return venue || location || null;
}

/** The nearest item on either side of `index` that names somewhere a
 * person could be dropped off.
 *
 * Walks outward rather than taking the immediate neighbour, because two
 * transport legs in a row is normal - a walk to the metro, then the metro
 * - and the neighbour is then another leg, which placeLabel refuses.
 * `step` is -1 for the origin and +1 for the destination. */
function nearestPlace(items: ItineraryItem[], index: number, step: -1 | 1): string | null {
  for (let i = index + step; i >= 0 && i < items.length; i += step) {
    const label = placeLabel(items[i]);
    if (label) return label;
  }
  return null;
}

function directionsUrl(origin: string, destination: string, mode: string | null): string {
  const params = new URLSearchParams({ api: "1", origin, destination });
  if (mode) params.set("travelmode", mode);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** True for the legs this file is about: ground transport, not a flight.
 *
 * is_flight is a structured field the model sets directly (see prompt.ts's
 * LANGUAGE-INDEPENDENT FIELDS), which is what makes this check work on a
 * trip written in any language. A flight already has its own link and must
 * not be given a driving route from Sofia to Bali. */
function isGroundLeg(item: ItineraryItem): boolean {
  return item.type === "transport" && item.is_flight !== true && !item.directions_url;
}

export function attachDirectionsLinks(itinerary: Itinerary, brief: TripBriefInput): Itinerary {
  const mode = brief.transport_preference ? TRAVEL_MODE[brief.transport_preference] : null;

  const days = (itinerary.days ?? []) as ItineraryDay[];
  const dayNumbers = days.map((d) => d.day);
  const firstDay = dayNumbers.length ? Math.min(...dayNumbers) : null;
  const lastDay = dayNumbers.length ? Math.max(...dayNumbers) : null;

  for (const day of days) {
    const items = day.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isGroundLeg(item)) continue;

      // The airport stands in for the end nothing else can supply, and it
      // is the transfer a traveler most wants a route for.
      //
      // A ground leg at the very start of the trip has no preceding stop
      // and one at the very end has nothing after it, so both were left
      // without a link - which on a real Rome trip meant the two airport
      // transfers, the legs with luggage in an unfamiliar city, were the
      // only ones with no directions. The brief names the airport, from
      // the closed set in lib/airports.ts, so this is the trip's own
      // stated fact rather than a guess at one; absent, nothing changes.
      const arrival = day.day === firstDay ? brief.arrival_airport?.trim() : undefined;
      const departure = day.day === lastDay ? brief.departure_airport?.trim() : undefined;

      const origin = nearestPlace(items, i, -1) ?? (arrival || null);
      const destination = nearestPlace(items, i, 1) ?? (departure || null);
      // No link rather than a wrong one. A leg with nothing named on one
      // side of it - the first item of the day, a transfer with no
      // written destination - cannot be turned into a route, and a link
      // that opens Maps on the wrong pair of places is worse for the
      // traveler than no link, as well as being a verification claim this
      // file would not be entitled to make.
      if (!origin || !destination) continue;
      // A route from somewhere to itself is not a route. This happens when
      // the leg sits between two items at the same venue (a coffee and a
      // talk at the same museum, with a walk written between them).
      if (origin === destination) continue;

      item.directions_url = directionsUrl(origin, destination, mode);
    }
  }

  return itinerary;
}
