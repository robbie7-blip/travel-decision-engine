// What to pack, derived from the trip rather than from a generic list.
//
// WHY THIS IS NOT A MODEL CALL. "What should I pack?" is one of the three
// topics Ask a Local advertises, and it is the one question the product can
// already answer without being asked: the trip page knows the real forecast
// for the real dates and the real shape of each day. A list computed from
// that costs nothing, cannot hallucinate a hiking boot into a city break,
// returns instantly, and - because the trip page works offline - is still
// there on the plane. A model call would be slower, cost money on a page
// that has already spent a generation, and be less trustworthy.
//
// WHAT IT IS ALLOWED TO LOOK AT, which is a shorter list than it first
// appears. The obvious move is to read the itinerary's item titles for
// "beach", "hike", "cathedral". That does not work here and must not be
// attempted: lib/types.ts says so directly above ItineraryItem - titles
// follow the trip's response language, which is why is_flight and
// venue_name exist as structured fields at all. A Bulgarian itinerary says
// "плаж". `interests` and `party_composition` are no better: both are free
// text the traveller typed, not a canonical set (validation.ts cheerfully
// accepts "a couple and my mother who cannot manage a long lunch").
//
// So this reads only what is language-independent and true:
//
//   - the forecast: min and max temperature, chance and amount of rain,
//     and a condition enum (lib/weather.ts)
//   - is_flight, a structured boolean
//   - how many nights the trip runs
//
// Every entry carries the fact that produced it, because that is this
// product's whole posture - every line on the trip page says where it came
// from, and a packing list that says "3 of your 6 days show rain above
// 50%" is a different object from one that says "umbrella".
//
// Run: npm run test:packing

import type { DayWeather, DestinationWeather } from "./weather";
import type { ItineraryDay } from "./types";

/** Why an item is on the list. The UI turns this into a sentence, in the
 * reading language - which is also why the reason is DATA and not English:
 * see lib/i18n.ts's result.packing. */
export type PackingReason =
  | { kind: "cold"; value: number }
  | { kind: "freezing"; value: number }
  | { kind: "hot"; value: number }
  | { kind: "swing"; value: number }
  | { kind: "rain"; value: number }
  | { kind: "snow"; value: number }
  | { kind: "flight" }
  | { kind: "longTrip"; value: number }
  | { kind: "always" };

export interface PackingEntry {
  /** Key into t.result.packing.items. */
  id: string;
  reason: PackingReason;
}

export interface PackingList {
  entries: PackingEntry[];
  /** The numbers the heading quotes, so the panel can say what it based
   * this on rather than presenting it as received wisdom. */
  coldestC: number | null;
  hottestC: number | null;
  rainyDays: number;
  nights: number;
  /** False when there is no forecast at all - the panel then says nothing
   * rather than offering a list built from two facts out of eight. */
  hasWeather: boolean;
  /** True when some of the forecast is a historical average rather than a
   * real forecast, which is the honest caveat for a trip booked months
   * out. See DayWeather.isForecast. */
  someHistorical: boolean;
}

/** Rain, counted the way a traveller would: a day worth taking a coat for.
 *
 * Both fields are checked because they are not both present. A real
 * forecast carries precipitationChance; a historical average carries
 * precipitationMm instead and leaves the chance null, because "chance of
 * rain" averaged across different years is not a meaningful number (see
 * lib/weather.ts). Reading only the chance would have reported every
 * trip more than ~16 days out as dry. */
const RAIN_CHANCE_PERCENT = 40;
const RAIN_MM = 3;
const WET_CONDITIONS = new Set(["rain", "thunderstorm"]);

function isWetDay(day: DayWeather): boolean {
  if (day.precipitationChance !== null && day.precipitationChance >= RAIN_CHANCE_PERCENT) return true;
  if (day.precipitationMm !== null && day.precipitationMm >= RAIN_MM) return true;
  return WET_CONDITIONS.has(day.condition);
}

function isSnowDay(day: DayWeather): boolean {
  return day.condition === "snow";
}

/** Nights between two ISO dates, or 0 if either is unusable. */
export function nightsBetween(startDate: string | undefined, endDate: string | undefined): number {
  if (!startDate || !endDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function packingListFor(input: {
  weather: DestinationWeather | null;
  days?: ItineraryDay[];
  startDate?: string;
  endDate?: string;
}): PackingList {
  // One flat list: a two-city trip's packing is decided by the coldest
  // morning and the wettest afternoon anywhere on it, not per city.
  const forecast: DayWeather[] = Object.values(input.weather ?? {}).flat();

  const temps = forecast.filter((d) => Number.isFinite(d.tempMinC) && Number.isFinite(d.tempMaxC));
  const coldestC = temps.length > 0 ? Math.min(...temps.map((d) => d.tempMinC)) : null;
  const hottestC = temps.length > 0 ? Math.max(...temps.map((d) => d.tempMaxC)) : null;
  // The widest single day, not the spread across the trip: packing for a
  // day that starts at 4C and reaches 20C is a layering problem, and two
  // different cities being different is not.
  const widestSwing = temps.reduce((worst, d) => Math.max(worst, d.tempMaxC - d.tempMinC), 0);
  // Calendar days, not forecast rows. The weather holds one row per city
  // per date, so a three-city, three-day trip has nine rows, and counting
  // rows told a family on a 48-hour trip "rain forecast on 5 of your
  // days". A date is rainy if it rains anywhere the trip goes that day.
  const rainyDays = new Set(forecast.filter(isWetDay).map((d) => d.date)).size;
  const snowyDays = new Set(forecast.filter(isSnowDay).map((d) => d.date)).size;
  const nights = nightsBetween(input.startDate, input.endDate);

  const hasFlight = (input.days ?? []).some((day) =>
    (day?.items ?? []).some((item) => item?.is_flight === true)
  );

  const entries: PackingEntry[] = [];
  const add = (id: string, reason: PackingReason) => entries.push({ id, reason });

  // Weather, in the order somebody would actually think about it.
  if (snowyDays > 0) add("snowBoots", { kind: "snow", value: snowyDays });
  if (coldestC !== null && coldestC <= 0) add("hatGloves", { kind: "freezing", value: coldestC });
  if (coldestC !== null && coldestC <= 3) add("winterCoat", { kind: "freezing", value: coldestC });
  else if (coldestC !== null && coldestC <= 13) add("warmLayer", { kind: "cold", value: coldestC });
  if (widestSwing >= 11) add("layers", { kind: "swing", value: Math.round(widestSwing) });
  if (rainyDays > 0) add("rainShell", { kind: "rain", value: rainyDays });
  if (rainyDays >= 2) add("umbrella", { kind: "rain", value: rainyDays });
  if (hottestC !== null && hottestC >= 25) add("sunProtection", { kind: "hot", value: hottestC });
  if (hottestC !== null && hottestC >= 28) add("sunHat", { kind: "hot", value: hottestC });
  if (hottestC !== null && hottestC >= 23) add("waterBottle", { kind: "hot", value: hottestC });

  // The flight, from a structured field rather than a guess at a title.
  if (hasFlight) {
    add("liquidsBag", { kind: "flight" });
    add("medsCarryOn", { kind: "flight" });
  }

  // Long enough that clothes become a logistics question rather than a
  // suitcase question.
  if (nights >= 7) add("laundryPlan", { kind: "longTrip", value: nights });

  // True of every itinerary this product produces, which is the only
  // honest basis for a line with no fact behind it. Walking shoes are on
  // here because an itinerary is a list of places to be at times; the
  // other two are what people actually forget.
  add("walkingShoes", { kind: "always" });
  add("adapter", { kind: "always" });
  add("documents", { kind: "always" });

  return {
    entries,
    coldestC: coldestC === null ? null : Math.round(coldestC),
    hottestC: hottestC === null ? null : Math.round(hottestC),
    rainyDays,
    nights,
    hasWeather: forecast.length > 0,
    someHistorical: forecast.some((d) => d.isForecast === false),
  };
}
