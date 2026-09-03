"use client";

// The wait, as the trip being built rather than a spinner.
//
// This is the longest visual moment in the product: the better part of a
// minute, unavoidable, and the moment the traveler is most invested,
// because they have just asked for this and are waiting to see it. It was
// a rotating status line.
//
// The generator has always known more than it was saying. Phase 1 produces
// the plan - every day's date, city and one-line intent - at roughly the
// halfway point, and each day's own call lands separately after that. The
// worker now publishes both as they happen (see JobProgress in lib/jobs.ts),
// so the outline appears at the halfway mark and then fills in a day at a
// time.
//
// Nothing here is a fake progress bar. Every row is real content that
// exists, which is why it can be shown at all: a bar that animates on a
// timer is a lie about a wait, and this product's whole argument is that
// it does not do that.

import type { JobProgress } from "@/lib/jobs";
import type { Dictionary } from "@/lib/i18n";

export function TripBuilding({
  progress,
  destinations,
  message,
  t,
}: {
  progress: JobProgress | undefined;
  destinations?: string[];
  /** The rotating status line, still shown above the outline. */
  message: string;
  t: Dictionary;
}) {
  const days = progress?.days ?? [];
  const written = days.filter((d) => typeof d.itemCount === "number").length;

  return (
    <div className="trip-building">
      <div className="trip-building-head">
        <div className="font-display trip-building-title">
          {destinations && destinations.length > 0
            ? t.trip.buildingFor.replace("{places}", destinations.join(" · "))
            : t.trip.loading}
        </div>
        <div className="font-ui trip-building-status">{message}</div>
      </div>

      {days.length > 0 && (
        <>
          {/* A real count of real days, not a timer. */}
          <div className="font-ui trip-building-count">
            {t.trip.buildingProgress
              .replace("{done}", String(written))
              .replace("{total}", String(days.length))}
          </div>

          <ol className="trip-building-days">
            {days.map((day) => {
              const done = typeof day.itemCount === "number";
              return (
                <li key={day.day} className="trip-building-day" data-done={done}>
                  <div className="trip-building-day-head">
                    <span className="font-display trip-building-day-number">
                      {String(day.day).padStart(2, "0")}
                    </span>
                    <span className="trip-building-day-meta font-ui">
                      <span className="trip-building-day-city">{day.city}</span>
                      <span className="trip-building-day-date">{day.date}</span>
                    </span>
                    {done && <span className="trip-building-tick" aria-hidden>✓</span>}
                  </div>
                  <div className="trip-building-theme font-ui">{day.theme}</div>
                  {day.titles && day.titles.length > 0 && (
                    <ul className="trip-building-titles font-ui">
                      {day.titles.map((title, i) => (
                        <li key={i}>{title}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
