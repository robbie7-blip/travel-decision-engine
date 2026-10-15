// A published trip's days, read-only and server-rendered (/plans/<slug>).
//
// Deliberately not ItineraryResult: that is the traveller's own working
// page - pushback, edits, votes, spending, feedback - and none of it
// belongs on a public guide. This is the plan as a reader needs it: each
// line, why it was chosen, how sure decide is of it, and where to book.

import type { Dictionary } from "@/lib/i18n";
import type { Itinerary } from "@/lib/types";
import { affiliateIds, bookingLinkFor, groundLinkFor, stayDates } from "@/lib/bookingLinks";
import { safeHref } from "@/lib/linkify";
import { ConfidenceTag } from "./ui";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function PublishedPlan({ itinerary, destinations, t }: { itinerary: Itinerary; destinations: string[]; t: Dictionary }) {
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  const ids = affiliateIds();
  const stays = stayDates(days, undefined);

  return (
    <div>
      {days.map((day) => (
        <section key={day.day} className="plan-day">
          <h2 className="font-display plan-day-heading">
            {t.result.day} {String(day.day).padStart(2, "0")}
          </h2>
          {(Array.isArray(day.items) ? day.items : []).map((item, i) => {
            const link = bookingLinkFor(item, stays.get(`${day.day}:${i}`), ids) ?? groundLinkFor(item, destinations);
            const maps = safeHref(str(item.google_maps_url));
            const tier = item.confidence_tier ?? "inferred";
            return (
              <div key={i} className="plan-item">
                <ConfidenceTag tier={tier} label={t.tierTag[tier]} />
                <div className="plan-item-body">
                  <div className="plan-item-title">{str(item.title)}</div>
                  <div className="font-ui plan-item-meta">
                    {[str(item.location), str(item.time)].filter(Boolean).join(" · ")}
                    {typeof item.google_rating === "number" && ` · ★ ${item.google_rating.toFixed(1)}`}
                  </div>
                  {str(item.reasoning) && <p className="plan-item-why">{str(item.reasoning)}</p>}
                  <div className="font-ui plan-item-links">
                    {maps && (
                      <a href={maps} target="_blank" rel="noopener noreferrer">
                        {t.result.viewOnGoogleMaps} ↗
                      </a>
                    )}
                    {link && (
                      <a href={link.url} target="_blank" rel={link.affiliate ? "sponsored noopener noreferrer" : "noopener noreferrer"}>
                        {link.kind === "stay" ? t.result.booking.stay : link.kind === "transport" ? t.result.booking.transport : t.result.booking.tickets} ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
