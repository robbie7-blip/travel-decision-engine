// Aggregate "how much of this itinerary is actually backed by something
// checked, not a guess" — one honest number that headlines the detailed
// per-item evidence (see ItemEvidence in components/ItineraryResult.tsx).
// Deliberately binary rather than a weighted blend of tiers: "verified" vs
// "single source" vs "fact grounded" are real distinctions worth showing
// at the item level, but folding them into different point values for one
// top-line score would make the number arguable rather than simply true.
// "inferred" (an honest guess, no source at all) is the only tier that
// doesn't count toward it — UNLESS the item was separately confirmed by
// Google Places (checkVenues), which counts as grounded too: a confirmed
// real, open, rated venue is genuine verification even though the model
// itself no longer web-searches individual meals/activities (that search
// was the single biggest generation-time cost — see SEARCH_INSTRUCTIONS in
// worker/src/index.ts — Places now covers venue-reality/rating far faster).

import type { Itinerary } from "./types";

export interface TrustScore {
  groundedCount: number;
  totalCount: number;
  percent: number; // 0-100, rounded; 100 when totalCount is 0 (nothing to doubt)
}

export function computeTrustScore(itinerary: Itinerary): TrustScore {
  let groundedCount = 0;
  let totalCount = 0;
  for (const day of itinerary.days ?? []) {
    for (const item of day.items) {
      totalCount++;
      const searchGrounded = (item.confidence_tier ?? "inferred") !== "inferred";
      // A confirmed Places match — NOT merely the presence of a rating.
      // google_maps_url is only ever set once checkVenues matched the name
      // AND the location, so it's the real "this business exists, is open,
      // and is where we said it is" signal. Keyed off the rating instead,
      // this silently under-counted every venue whose rating sample was too
      // thin to display (see MIN_RATING_COUNT in venueVerification.ts) —
      // those are still fully verified as real places, which is what this
      // score actually claims to measure.
      const placesGrounded = item.google_maps_url != null || item.google_rating != null;
      // A flight's Google Flights deep link is exactly what a venue's Google
      // Maps link is: a real, checkable URL for that specific route and date,
      // built deterministically rather than guessed. The pipeline says so in
      // as many words — flights are deliberately not web-searched BECAUSE
      // the link is the verification mechanism (see SEARCH_INSTRUCTIONS in
      // worker/src/index.ts).
      //
      // The score counted the Maps link and ignored the Flights one, so
      // every transport leg in a trip scored zero no matter how checkable
      // it was. On a multi-city trip that's a meaningful slice of the line
      // items marked unverified while carrying a link the traveler can
      // click and confirm in one tap.
      const flightGrounded = item.flight_search_url != null;
      if (searchGrounded || placesGrounded || flightGrounded) groundedCount++;
    }
  }
  const percent = totalCount === 0 ? 100 : Math.round((groundedCount / totalCount) * 100);
  return { groundedCount, totalCount, percent };
}
