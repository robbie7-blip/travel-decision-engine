// What of an itinerary may appear on a public page (/plans/<slug>).
//
// An allowlist, like lib/publicBrief.ts, and for the same reason: the
// itinerary is model output written FOR this traveller, and several parts
// of it are about them rather than about the place - whether their budget
// is enough, the decisions made around their constraints, their flight
// from home. Those are left out; the days and the places in them stay.
// Lodging lines stay too: they are always decide's own suggestion (a
// traveller who already has somewhere to stay gets no lodging lines at
// all, see needs_lodging in lib/types.ts), so they are part of the guide.
//
// Applied when a trip is published and again when the page is read, so a
// page published before this existed is cleaned too.

import type { Itinerary, ItineraryDay, ItineraryItem } from "./types";

const ITEM_FIELDS = [
  "time",
  "type",
  "title",
  "venue_name",
  "location",
  "cost_estimate_eur",
  "reasoning",
  "confidence_tier",
  "source_confidence",
  "google_maps_url",
  "google_rating",
  "google_lat",
  "google_lng",
] as const;

function publicItem(item: ItineraryItem): ItineraryItem {
  const src = item as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ITEM_FIELDS) if (src[key] !== undefined) out[key] = src[key];
  return out as unknown as ItineraryItem;
}

/** Flights are the traveller's own journey from home, not part of a guide
 * to the place. */
function isPublicItem(item: unknown): item is ItineraryItem {
  if (!item || typeof item !== "object") return false;
  return !(item as ItineraryItem).is_flight;
}

export function publicItinerary(itinerary: unknown): Itinerary {
  const src = (itinerary && typeof itinerary === "object" ? itinerary : {}) as Partial<Itinerary>;
  const days: ItineraryDay[] = (Array.isArray(src.days) ? src.days : []).map((day) => {
    const d = day as unknown as Record<string, unknown>;
    return {
      day: d.day,
      ...(typeof d.date === "string" ? { date: d.date } : {}),
      ...(typeof d.city === "string" ? { city: d.city } : {}),
      items: (Array.isArray(d.items) ? d.items : []).filter(isPublicItem).map(publicItem),
    } as unknown as ItineraryDay;
  });
  return {
    ...(typeof src.trip_summary === "string" ? { trip_summary: src.trip_summary } : {}),
    days,
  } as unknown as Itinerary;
}
