// Attaches a real, always-present Google Flights link to arrival/departure
// transport items that are actual flights - the same "give a real,
// verifiable link, don't just assert a number" principle behind the Google
// Maps links on named venues (see venueVerification.ts). Built
// deterministically from the trip brief rather than depending on whether
// the model's own web_search (see SEARCH_INSTRUCTIONS in index.ts) happened
// to surface a usable source_url - a flight item should never go without a
// real place to check today's actual price, even on a cache hit or a search
// that came back empty.
//
// Google Flights' `/travel/flights?q=` endpoint accepts a natural-language
// query (e.g. "Flights from Sofia to Hurghada on 2027-01-22") and doesn't
// require IATA airport codes, unlike Skyscanner-style URLs - a real
// advantage here since the trip brief only ever has city names, never
// airport codes. This isn't a live-priced quote (Google Flights runs its
// own fresh search when the link is opened), it's a real, clickable place
// to verify the route/date actually exists and see today's price.
//
// Detection relies on item.is_flight (a structured field the model sets
// directly per prompt.ts's LANGUAGE-INDEPENDENT FIELDS instruction), NOT on
// matching the word "flight" in the title - titles follow the trip's
// response language, so a Bulgarian trip's title reads "Полет от София
// до..." and an English-word regex would silently never match, meaning no
// Bulgarian trip would ever get this link. Confirmed bug, not hypothetical:
// this used to be exactly that regex and it broke every non-English trip.

import type { Itinerary, ItineraryItem, TripBriefInput } from "../types";

function googleFlightsUrl(origin: string, destination: string, date: string): string {
  const query = `Flights from ${origin} to ${destination} on ${date}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}

function attachIfFlight(item: ItineraryItem, origin: string, destination: string, date: string): void {
  if (item.type === "transport" && item.is_flight === true && !item.flight_search_url) {
    item.flight_search_url = googleFlightsUrl(origin, destination, date);
  }
}

export function attachFlightSearchLinks(itinerary: Itinerary, brief: TripBriefInput): Itinerary {
  // Only real cases with an actual flight to check: an origin was given and
  // transport isn't already booked separately (needs_flight defaults true).
  if (!brief.origin?.trim() || brief.needs_flight === false) return itinerary;
  if (brief.destinations.length === 0) return itinerary;

  const days = itinerary.days ?? [];
  if (days.length === 0) return itinerary;

  const origin = brief.origin.trim();
  // Multi-city trips: the first-listed destination is the actual arrival
  // point, the last-listed is where the traveler departs from - matches how
  // the system prompt already reasons about arrival/departure transport.
  const arrivalDestination = brief.destinations[0];
  const departureDestination = brief.destinations[brief.destinations.length - 1];
  const arrivalDate = brief.arrival_date?.trim() || brief.start_date;
  const departureDate = brief.end_date;

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  for (const item of firstDay.items) {
    attachIfFlight(item, origin, arrivalDestination, arrivalDate);
  }
  if (lastDay !== firstDay) {
    for (const item of lastDay.items) {
      attachIfFlight(item, departureDestination, origin, departureDate);
    }
  }

  return itinerary;
}
