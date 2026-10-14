// A few lines of a real, already-generated trip, for the homepage.
//
// The homepage could already link to a real example (lib/demoTrip.ts), as
// one line of small underlined text. For a product nobody has heard of, the
// plan itself is the strongest argument there is: what it looks like, and
// that every line says how sure it is. So /api/demo-trip now returns a
// small excerpt of the plan alongside the link.
//
// WHAT IT MAY CONTAIN. Only what the public /trip/[id] page already shows
// to anyone with the link: the dates of the days, item times and titles,
// their confidence tier, and the trip's trust score. Nothing from the
// brief - party, budget, origin, mobility, diet, hotel - which is the line
// PublicTripBrief draws for the same page (see lib/publicBrief.ts).
//
// Pure, so the choice of which lines to show is tested.
//
// Run: npm run test:demo-preview

import type { ConfidenceTier, Itinerary, ItineraryDay } from "./types";
import { computeTrustScore } from "./trustScore";

export const PREVIEW_LINES = 4;
const MAX_TITLE = 90;

export interface DemoPreviewLine {
  time: string;
  title: string;
  tier: ConfidenceTier;
}

export interface DemoPreview {
  days: number;
  startDate: string;
  endDate: string;
  trustPercent: number;
  /** Which day of the trip the lines are from, 1-based, and its date. */
  day: number;
  dayDate: string;
  lines: DemoPreviewLine[];
}

function usableItems(day: ItineraryDay | null | undefined) {
  return (day?.items ?? []).filter(
    (item) => item && typeof item.title === "string" && item.title.trim() !== "" && item.is_flight !== true
  );
}

/** The day that best shows what the product does: among the first three,
 * the one whose opening lines carry the most DIFFERENT confidence tiers -
 * a preview of five "verified" lines says less about the honesty than one
 * that also shows an honest guess - with more lines as the tie-break, and
 * the earliest after that. Day 1 is often an arrival afternoon with two
 * entries in it, which is why this does not simply take day 1. */
function bestDay(days: ItineraryDay[]): number {
  let best = -1;
  let bestScore = -1;
  days.slice(0, 3).forEach((day, i) => {
    const items = usableItems(day).slice(0, PREVIEW_LINES);
    if (items.length === 0) return;
    const tiers = new Set(items.map((item) => item.confidence_tier ?? "inferred")).size;
    const score = tiers * 10 + items.length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export function demoPreviewOf(itinerary: Itinerary | null | undefined): DemoPreview | null {
  const days = (itinerary?.days ?? []).filter((d): d is ItineraryDay => Boolean(d));
  if (!itinerary || days.length === 0) return null;
  const index = bestDay(days);
  if (index === -1) return null;
  const day = days[index];

  const lines = usableItems(day)
    .slice(0, PREVIEW_LINES)
    .map((item) => {
      const title = item.title.trim();
      return {
        time: typeof item.time === "string" ? item.time.trim().slice(0, 5) : "",
        title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title,
        tier: item.confidence_tier ?? "inferred",
      };
    });

  return {
    days: days.length,
    startDate: typeof days[0].date === "string" ? days[0].date : "",
    endDate: typeof days[days.length - 1].date === "string" ? days[days.length - 1].date : "",
    trustPercent: computeTrustScore(itinerary).percent,
    day: index + 1,
    dayDate: typeof day.date === "string" ? day.date : "",
    lines,
  };
}
