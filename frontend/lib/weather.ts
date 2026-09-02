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
