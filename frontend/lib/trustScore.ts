// Aggregate "how much of this itinerary is actually backed by something
// checked, not a guess" — one honest number that headlines the detailed
// per-item evidence (see ItemEvidence in components/ItineraryResult.tsx).
// Deliberately binary rather than a weighted blend of tiers: "verified" vs
// "single source" vs "fact grounded" are real distinctions worth showing
// at the item level, but folding them into different point values for one
// top-line score would make the number arguable rather than simply true.
// "inferred" (an honest guess, no source at all) is the only tier that
// doesn't count toward it.

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
      if ((item.confidence_tier ?? "inferred") !== "inferred") groundedCount++;
    }
  }
  const percent = totalCount === 0 ? 100 : Math.round((groundedCount / totalCount) * 100);
  return { groundedCount, totalCount, percent };
}
