"use client";

// The top of a finished itinerary.
//
// The page used to open on a green paragraph. For the product's main
// artifact - the thing someone waited a minute for and will come back to
// on the trip itself - that is a document, not a destination. This gives
// it a cover: the place, the dates, how many days, and the two stamps that
// say whether it is affordable and how much of it was checked.
//
// The photo comes from the destination guides already in the repo, so it
// costs nothing and is a real picture of the real city. When there is no
// photo for a destination, which is most of the world, the cover keeps the
// same shape in the brand's deep green rather than showing a stock image
// of somewhere else - a photo of the wrong city on your own itinerary
// reads as carelessness, and this product is built on not doing that.

import { coverPhotoFor } from "@/lib/tripCover";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

function formatRange(start: string | undefined, end: string | undefined, language: Language): string | null {
  if (!start || !end) return null;
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const locale = language === "bg" ? "bg-BG" : "en-GB";
  const sameMonth = from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear();
  const dayOnly = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
  const full = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  // "12 to 15 October 2026" rather than repeating the month twice.
  return sameMonth ? `${dayOnly.format(from)} to ${full.format(to)}` : `${full.format(from)} to ${full.format(to)}`;
}

export function TripCover({
  destinations,
  startDate,
  endDate,
  dayCount,
  t,
  language,
  children,
}: {
  destinations: string[] | undefined;
  startDate?: string;
  endDate?: string;
  dayCount: number;
  t: Dictionary;
  language: Language;
  /** The budget and trust stamps, passed in rather than recomputed here so
   * this component owns layout and nothing else. */
  children?: React.ReactNode;
}) {
  const photo = coverPhotoFor(destinations);
  const title = (destinations ?? []).join(" · ");
  const range = formatRange(startDate, endDate, language);

  if (!title) return null;

  return (
    <header className="trip-cover" data-has-photo={photo !== null}>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.src} alt="" className="trip-cover-photo" />
      )}
      <div className="trip-cover-scrim" />
      <div className="trip-cover-body">
        <div className="trip-cover-eyebrow font-ui">
          {dayCount > 0 && <span>{t.result.dayCount.replace("{count}", String(dayCount))}</span>}
          {range && <span>{range}</span>}
        </div>
        <h1 className="trip-cover-title font-display">{title}</h1>
        {children && <div className="trip-cover-stamps">{children}</div>}
      </div>
    </header>
  );
}
