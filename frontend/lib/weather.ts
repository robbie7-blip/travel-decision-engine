// Shared between the /api/weather route and the frontend WeatherStrip
// component. Source is Open-Meteo (open-meteo.com) - free, no API key,
// no signup - rather than a keyed provider like AccuWeather.

export type WeatherCondition = "clear" | "partly-cloudy" | "cloudy" | "fog" | "rain" | "snow" | "thunderstorm";

export interface DayWeather {
  date: string; // YYYY-MM-DD
  // true = a real short-range forecast for this exact date; false = a
  // historical average (see ARCHIVE_YEARS below) because the trip is
  // further out than Open-Meteo's ~16-day forecast horizon.
  isForecast: boolean;
  tempMaxC: number;
  tempMinC: number;
  // 0-100, forecast only - historical averages report a precipitation
  // total instead, since "chance of rain" isn't meaningful averaged
  // across different years.
  precipitationChance: number | null;
  precipitationMm: number | null;
  condition: WeatherCondition;
}

export type DestinationWeather = Record<string, DayWeather[]>;

// Open-Meteo's short-range forecast model reliably covers this many days
// from today - beyond it, we fall back to historical averages instead of
// a forecast that wouldn't actually be meaningful that far out.
export const FORECAST_HORIZON_DAYS = 15;

// How many past years to average for the historical-fallback case - enough
// to smooth out one unusually hot/rainy year without requiring a huge
// number of upstream calls per destination.
export const ARCHIVE_YEARS = 5;

// WMO weather interpretation codes, as used by Open-Meteo's `weathercode`
// daily field - https://open-meteo.com/en/docs, bucketed down to the handful
// of conditions the UI actually distinguishes.
const WMO_CONDITION: Record<number, WeatherCondition> = {
  0: "clear",
  1: "partly-cloudy",
  2: "partly-cloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "rain",
  53: "rain",
  55: "rain",
  56: "rain",
  57: "rain",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "rain",
  81: "rain",
  82: "rain",
  85: "snow",
  86: "snow",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

export function conditionFromWmoCode(code: number): WeatherCondition {
  return WMO_CONDITION[code] ?? "cloudy";
}

/** How many whole days from today (UTC) a given YYYY-MM-DD date is -
 * negative for the past, 0 for today. Used to decide forecast vs
 * historical-average per destination. */
export function daysFromToday(dateStr: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const [y, m, d] = dateStr.split("-").map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

/** One archive year's daily block, as Open-Meteo returns it. */
export interface DailyBlock {
  time: string[];
  weathercode: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max?: number[];
  precipitation_sum?: number[];
}

export function shiftYear(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y - years, m - 1, d));
  // February 29 has no counterpart in a non-leap year, and Date.UTC rolls
  // it FORWARD: shiftYear("2028-02-29", 1) returned "2027-03-01". That moves
  // the whole queried window a day off the trip's own calendar span, so
  // that year then has no data for any day the trip actually asks about.
  // Clamped to the last day of the intended month instead - setUTCDate(0)
  // steps back into it, since the roll-over landed us in the next one.
  if (shifted.getUTCMonth() !== ((m - 1) % 12 + 12) % 12) {
    shifted.setUTCDate(0);
  }
  return shifted.toISOString().slice(0, 10);
}

function mostCommon(values: WeatherCondition[]): WeatherCondition {
  const counts = new Map<WeatherCondition, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: WeatherCondition = values[0];
  let bestCount = 0;
  for (const [condition, count] of counts) {
    if (count > bestCount) {
      best = condition;
      bestCount = count;
    }
  }
  return best;
}

// A plain plurality vote over weathercodes can pick a precipitation
// condition (rain/snow/thunderstorm) as the "most common" even when it's a
// minority of the sampled years - e.g. 2 of 5 years had a light-drizzle code
// and the other 3 split evenly across clear/partly-cloudy/cloudy, so drizzle
// "wins" with only 2 votes. That produced a real, confirmed contradiction: a
// rain icon shown next to "Avg rain: 0mm", since the averaged precipitation
// across all 5 years (including the 3 dry ones) rounds down to nothing. A
// precipitation condition is only trusted here when the averaged mm actually
// backs it up - otherwise the icon falls back to the plurality among the
// non-precipitation years, which is what the traveler should actually expect.
const PRECIP_CONDITIONS = new Set<WeatherCondition>(["rain", "snow", "thunderstorm"]);
const MIN_AVG_PRECIP_FOR_ICON_MM = 1;

function pickHistoricalCondition(conditions: WeatherCondition[], avgPrecipMm: number | null): WeatherCondition {
  const mode = mostCommon(conditions);
  if (!PRECIP_CONDITIONS.has(mode) || (avgPrecipMm ?? 0) >= MIN_AVG_PRECIP_FOR_ICON_MM) return mode;
  const nonPrecip = conditions.filter((c) => !PRECIP_CONDITIONS.has(c));
  return nonPrecip.length > 0 ? mostCommon(nonPrecip) : "cloudy";
}

/** Averages the archive years into one row per TRIP day.
 *
 * Pure, and separated from the fetching for that reason - it was inline in
 * the route, where it could not be tested without stubbing the network, and
 * Next.js will not let a route module export anything but its handlers. The
 * two defects below were found by measuring the real calendar, which is
 * exactly the kind of thing a test should have been holding. */
export function averageHistoricalYears(validYears: DailyBlock[], start: string, end: string): DayWeather[] {
  if (validYears.length === 0) return [];

  // ALIGNED BY MONTH-DAY, not by index into each year's array.
  //
  // This used to take `dayCount` from validYears[0].time.length and read
  // `y.temperature_2m_max[i]` from every year at the same i, on the stated
  // assumption that "every valid year should have the same number of days
  // for the same start/end month-day span". February 29 breaks that, and
  // the failure is silent and wrong rather than empty.
  //
  // Measured, for a trip 2027-02-27 to 2027-03-02: the archive returns 4
  // days for 2026, 2025, 2023 and 2022, and 5 for 2024. Index 2 is 03-01 in
  // 2026 but 02-29 in 2024 - so the leap year's February 29 weather was
  // averaged into the traveller's March 1 row, and its March 1 into March
  // 2, shifting that year by a day for the rest of the range. The whole
  // premise of showing historical weather is that it is real; a silently
  // misaligned average is worse than no figure.
  //
  // Keying on MM-DD makes array lengths irrelevant: each year supplies the
  // value for the calendar day being asked about, or supplies nothing and
  // is simply not averaged in.
  const byMonthDay = validYears.map((y) => {
    const index = new Map<string, number>();
    y.time.forEach((iso, i) => index.set(iso.slice(5), i));
    return { year: y, index };
  });

  const [startY, startM, startD] = start.split("-").map(Number);
  const [endY, endM, endD] = end.split("-").map(Number);
  // The TRIP's own length, which is the authoritative number - it used to
  // come from a historical year's array, so a leap year one day longer than
  // the trip added a row the traveller has no day for, and one day shorter
  // dropped a day they do.
  const dayCount =
    Math.round((Date.UTC(endY, endM - 1, endD) - Date.UTC(startY, startM - 1, startD)) / 86_400_000) + 1;
  if (!Number.isFinite(dayCount) || dayCount <= 0) return [];

  const tripDates = Array.from({ length: dayCount }, (_, i) => {
    // Date.UTC's month is 0-indexed - startM (e.g. 11 for November) must be
    // passed as startM - 1, or it silently rolls forward a month (November
    // becoming December was confirmed happening in practice).
    const d = new Date(Date.UTC(startY, startM - 1, startD));
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  return tripDates.map((date) => {
    const monthDay = date.slice(5);
    // A trip that actually falls on February 29 has no counterpart in a
    // non-leap historical year, so those years answer for February 28
    // instead of dropping out entirely - the nearest real day, rather than
    // a row with no data behind it.
    const rows = byMonthDay
      .map(({ year, index }) => {
        const i = index.get(monthDay) ?? (monthDay === "02-29" ? index.get("02-28") : undefined);
        return i === undefined ? null : { year, i };
      })
      .filter((r): r is { year: DailyBlock; i: number } => r !== null);

    const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const maxes = rows.map(({ year, i }) => year.temperature_2m_max[i]).filter(num);
    const mins = rows.map(({ year, i }) => year.temperature_2m_min[i]).filter(num);
    const precips = rows.map(({ year, i }) => year.precipitation_sum?.[i]).filter(num);
    // Filtered like the temperatures above, which it was not:
    // conditionFromWmoCode(undefined) returns "cloudy", so a year with no
    // data for this day used to cast a phantom vote for cloudy in
    // mostCommon and could flip the icon on its own.
    const conditions = rows
      .map(({ year, i }) => year.weathercode[i])
      .filter(num)
      .map(conditionFromWmoCode);

    const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
    const avgPrecipMm = precips.length ? Math.round(avg(precips)) : null;

    return {
      date,
      isForecast: false,
      tempMaxC: Math.round(avg(maxes)),
      tempMinC: Math.round(avg(mins)),
      precipitationChance: null,
      precipitationMm: avgPrecipMm,
      condition: conditions.length > 0 ? pickHistoricalCondition(conditions, avgPrecipMm) : "cloudy",
    };
  });
}

