"use client";

// One real photograph per day, of a venue the day actually visits.
//
// This is the only thing on the page with an ongoing cost: Google bills per
// photo fetched, so the count is capped at one per day rather than one per
// line. A four-day trip is four fetches, cached for a month upstream by
// /api/venue-photo, which is a few hundredths of a cent per trip and buys
// every day a picture of somewhere real instead of a stock image of a city
// the traveler is not going to.
//
// The venue is chosen, not random: the day's most-reviewed activity, which
// is the closest thing to "the thing you would take a picture of today".
// Falls back to any photographed venue, and renders nothing when the day
// has none - a day of unverified items has no photo to show, which is the
// correct outcome rather than a placeholder.

import { useState } from "react";
import type { ItineraryItem } from "@/lib/types";

/** Ranks the day's photographed venues. Activities first because a museum
 * or a viewpoint is what a day looks like; a restaurant interior is not.
 * Within a type, more reviews means a more recognisable place. */
function heroOf(items: ItineraryItem[]): ItineraryItem | null {
  const candidates = items.filter((i) => typeof i.google_photo_name === "string" && i.google_photo_name);
  if (candidates.length === 0) return null;

  const rank = (item: ItineraryItem): number => {
    const typeScore = item.type === "activity" ? 2 : item.type === "meal" ? 1 : 0;
    return typeScore * 1_000_000 + (item.google_rating_count ?? 0);
  };
  return candidates.reduce((best, item) => (rank(item) > rank(best) ? item : best), candidates[0]);
}

export function DayPhoto({ items }: { items: ItineraryItem[] }) {
  const [failed, setFailed] = useState(false);
  const hero = heroOf(items);

  // A broken image is worse than none: if Google's photo has gone, or no
  // key is configured, the day just goes back to being text.
  if (!hero?.google_photo_name || failed) return null;

  const label = hero.venue_name || hero.title;

  return (
    <figure className="day-photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/venue-photo?name=${encodeURIComponent(hero.google_photo_name)}`}
        alt={label}
        loading="lazy"
        onError={() => setFailed(true)}
        className="day-photo-img"
      />
      <figcaption className="day-photo-caption font-ui">{label}</figcaption>
    </figure>
  );
}
