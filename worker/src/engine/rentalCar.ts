// The rental car, when the traveller picked "Rental car" as how they want
// to get around.
//
// The plan is told to drive (prompt.ts), and the rental itself is one line
// on the first day carrying the whole rental's cost, so the trip's total
// includes it. Its price comes from a web search made alongside planning
// (prefetchRentalCar in index.ts), the same way accommodation prices do:
// when the search found a rate, the line carries that rate and its source
// and is badged as checked; when it did not, the line keeps the model's own
// estimate and says so. Fuel, tolls and parking stay on the driving legs,
// where the plan already prices them.
//
// Run: npm run test:rental-car

import type { Itinerary, ItineraryItem, TripBriefInput } from "../types";

export interface RentalQuote {
  /** Typical price per day, in EUR. */
  dailyEur: number;
  /** The kind of car the price is for, e.g. "mid-size estate". */
  carClass: string;
  sourceUrl: string;
}

/** The car a party actually fits in, with luggage. Asked for by size so
 * the price is for a car they could use: a compact's rate is no help to a
 * family of five. */
export function carClassFor(partySize: number): string {
  if (partySize >= 5) return "7-seater people carrier";
  if (partySize >= 3) return "mid-size or estate car";
  return "compact car";
}

export const RENTAL_SYSTEM = `Find the current typical price per day to rent a car at the given place, for the \
given dates and kind of car, using web search. Prefer a comparison site or a major rental company's own price \
for those dates; include the basic insurance a normal booking includes.

Respond with ONLY this JSON, no other text:
{"daily_eur": <number, converted to EUR if the source quoted another currency>, "car_class": "<the kind of car \
the price is for>", "source_url": "<the URL you used>"}

If nothing usable is found, return exactly: {"daily_eur": null, "car_class": null, "source_url": null}. Never \
invent a number or a URL.`;

export function rentalUserMessage(brief: Pick<TripBriefInput, "destinations" | "start_date" | "end_date" | "party_size">): string {
  return (
    `Pick-up place: ${brief.destinations[0] ?? ""}\n` +
    `Dates: ${brief.start_date} to ${brief.end_date}\n` +
    `Car: a ${carClassFor(brief.party_size)} for ${brief.party_size} ${brief.party_size === 1 ? "person" : "people"}`
  );
}

/** The search's reply, or null. A rate outside what any real rental costs
 * is a misread page, not a price, and is treated as nothing found. */
export function readRentalReply(raw: unknown, fallbackClass: string): RentalQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const daily = typeof r.daily_eur === "number" ? r.daily_eur : Number.NaN;
  const url = typeof r.source_url === "string" ? r.source_url.trim() : "";
  if (!Number.isFinite(daily) || daily < 8 || daily > 600 || !/^https?:\/\//.test(url)) return null;
  const carClass = typeof r.car_class === "string" && r.car_class.trim() ? r.car_class.trim().slice(0, 60) : fallbackClass;
  return { dailyEur: Math.round(daily), carClass, sourceUrl: url };
}

/** Days the car is kept: the trip's days, counted inclusively, at least 1. */
export function rentalDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

const RENTAL_LINE = /\b(?:rental car|car rental|car hire|hire car|rent(?:ing)? a car|pick up (?:the |your )?(?:rental )?car)\b|кола под наем|наем(?:ане)? на кола|вземане на колата/iu;

/** The plan's own rental line, if it wrote one: a transport item whose
 * title is about collecting or renting the car. Driving legs ("Drive to
 * Lindau by rental car") are not it - they carry fuel, not the rental. */
export function findRentalLine(itinerary: Itinerary): ItineraryItem | null {
  for (const day of itinerary.days ?? []) {
    for (const item of day?.items ?? []) {
      if (!item || item.type !== "transport" || typeof item.title !== "string") continue;
      if (!RENTAL_LINE.test(item.title)) continue;
      // A letter lookahead, not \b: \b only knows Latin letters, so it never
      // ended a Bulgarian word and "Шофиране до..." was not recognised.
      if (/^(?:drive|driving|return|шофиране|път)(?!\p{L})/iu.test(item.title.trim())) continue;
      return item;
    }
  }
  return null;
}

/** Makes sure the trip carries the rental, priced from the search when it
 * found a rate. Returns what it did, for the job's log. */
export function applyRentalCar(
  itinerary: Itinerary,
  brief: Pick<TripBriefInput, "destinations" | "start_date" | "end_date" | "party_size" | "language" | "transport_preference">,
  quote: RentalQuote | null
): "priced" | "added" | "estimate kept" | "none" {
  if (brief.transport_preference !== "rental_car") return "none";
  const days = rentalDays(brief.start_date, brief.end_date);
  const bg = brief.language === "bg";
  const existing = findRentalLine(itinerary);

  if (!quote) return existing ? "estimate kept" : "none";

  const total = quote.dailyEur * days;
  const reasoning = bg
    ? `${quote.carClass}, ${days} ${days === 1 ? "ден" : "дни"} по около €${quote.dailyEur} на ден по актуални цени. Горивото, таксите и паркингът са към самите пътувания.`
    : `${quote.carClass} for ${days} ${days === 1 ? "day" : "days"} at about €${quote.dailyEur} a day, from current prices. Fuel, tolls and parking are on the drives themselves.`;

  if (existing) {
    existing.cost_estimate_eur = total;
    existing.reasoning = reasoning;
    existing.source_confidence = "grounded";
    existing.source_urls = [quote.sourceUrl];
    existing.source_agreement = null;
    return "priced";
  }

  const first = itinerary.days?.[0];
  if (!first || !Array.isArray(first.items)) return "none";
  // Right after arriving when the day opens with the arrival (the car is
  // collected at the airport or station), otherwise first thing. Same
  // time as the item it follows; the day's stable sort keeps the order.
  // The earliest item by time, not the first in the list: the day is not
  // sorted yet when this runs.
  const minutes = (t: unknown) => {
    const m = typeof t === "string" ? /^(\d{1,2}):(\d{2})$/.exec(t) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : Number.POSITIVE_INFINITY;
  };
  const opener = first.items
    .filter((i) => !!i && typeof i === "object")
    .reduce<ItineraryItem | undefined>((best, i) => (!best || minutes(i.time) < minutes(best.time) ? i : best), undefined);
  const afterArrival = opener?.type === "transport";
  const at = typeof opener?.time === "string" && /^\d{1,2}:\d{2}$/.test(opener.time) ? opener.time : "10:00";
  const openerIndex = opener ? first.items.indexOf(opener) : -1;
  first.items.splice(afterArrival ? openerIndex + 1 : 0, 0, {
    time: at,
    type: "transport",
    title: bg ? "Вземане на колата под наем" : "Pick up the rental car",
    location: brief.destinations[0] ?? "",
    cost_estimate_eur: total,
    reasoning,
    source_confidence: "grounded",
    source_urls: [quote.sourceUrl],
    source_agreement: null,
  } as ItineraryItem);
  return "added";
}
