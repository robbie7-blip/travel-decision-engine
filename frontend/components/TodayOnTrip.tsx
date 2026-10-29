"use client";

// The trip page on the day itself.
//
// The itinerary below is a plan: every day laid out at once, which is the
// right shape while deciding and the wrong one while standing in a street
// in Rome on day three. This leads with today - what is next, what has
// already been, and nothing else competing for the top of the page.
//
// Rendered only when today IS a trip day, so it is absent while planning
// and absent after the trip. The decision is in lib/today.ts, pure and
// tested; this is the rendering.
//
// No fetch and no model call, so it works offline - which matters more
// here than anywhere else on the page, since the whole point is the screen
// you open while actually travelling. The trip page is already cached for
// offline use (public/sw.js).

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { localDateOf, minutesOfDay, todayOnTrip } from "@/lib/today";
import type { ItineraryDay, ItineraryItem } from "@/lib/types";
import { itemTitle } from "@/lib/itemTitle";

/** Re-read the clock every minute, so "next" stops being whatever it was
 * when the page happened to load. A minute is the granularity of the
 * times in an itinerary, so anything finer would be redraws for nothing. */
function useNow(): Date {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // null until mounted, deliberately: the server has no idea what day it
  // is where the reader is, and rendering a guess would hydrate into a
  // different answer.
  return now ?? new Date(0);
}

function Line({ item, lead }: { item: ItineraryItem; lead?: boolean }) {
  return (
    <li className="today-item" data-lead={lead ? "true" : undefined}>
      <span className="today-time font-mono">{item.time || ""}</span>
      <span className="today-what">
        <span className="today-title">{itemTitle(item)}</span>
        {item.location && <span className="today-where font-ui">{item.location}</span>}
      </span>
    </li>
  );
}

export function TodayOnTripPanel({ days, t }: { days?: ItineraryDay[]; t: Dictionary }) {
  const now = useNow();
  // Epoch means "not mounted yet" - see useNow. Nothing is rendered until
  // the browser has told us what day it is.
  if (now.getTime() === 0) return null;

  const view = todayOnTrip(days, localDateOf(now), now.getHours() * 60 + now.getMinutes());
  if (!view.day) return null;

  const copy = t.result.today;
  const hasItems = view.past.length + view.upcoming.length > 0;
  const [next, ...later] = view.upcoming;

  return (
    <section className="today no-print" aria-label={copy.heading}>
      <div className="today-head">
        <h2 className="font-display today-heading">{copy.heading}</h2>
        <span className="today-position font-ui">
          {copy.position.replace("{day}", String(view.position)).replace("{total}", String(view.total))}
        </span>
      </div>

      {!hasItems && <p className="today-note font-ui">{copy.free}</p>}

      {next && (
        <>
          <div className="today-label font-ui">{copy.next}</div>
          <ul className="today-list">
            <Line item={next} lead />
            {later.map((item, i) => (
              <Line key={`${item.time}-${i}`} item={item} />
            ))}
          </ul>
        </>
      )}

      {hasItems && !next && <p className="today-note font-ui">{copy.done}</p>}

      {view.past.length > 0 && (
        <details className="today-past">
          <summary className="font-ui">
            {copy.earlier} ({view.past.length})
          </summary>
          <ul className="today-list today-list-past">
            {view.past.map((item, i) => (
              <Line key={`${item.time}-${i}`} item={item} />
            ))}
          </ul>
        </details>
      )}

      {/* The plan is still below; this panel is a lens on it, not a
          replacement. Anchored rather than a route, so it works offline. */}
      <a href="#trip-days" className="font-ui today-all">
        {copy.seeWholeTrip} &darr;
      </a>
    </section>
  );
}

export { minutesOfDay };
