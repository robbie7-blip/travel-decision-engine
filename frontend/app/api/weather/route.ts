// Weather outlook for a trip's destinations/dates — real short-range
// forecast when the trip is within Open-Meteo's ~15-day horizon, otherwise
// a historical average across the last few years for those same calendar
// dates (clearly marked as such, never presented as a forecast). Open-Meteo
// is used deliberately over a keyed provider (AccuWeather etc.): free,
// no signup, no API key to manage.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import {
  ARCHIVE_YEARS,
  conditionFromWmoCode,
  daysFromToday,
  FORECAST_HORIZON_DAYS,
  type DayWeather,
  type DestinationWeather,
  type WeatherCondition,
} from "@/lib/weather";

export const runtime = "nodejs";

// A real forecast (especially precipitation) can meaningfully change within
// hours, so it's cached briefly — long enough to spare repeat page views
// from re-hitting Open-Meteo, short enough that the shown forecast doesn't
// go stale. A historical average across past years barely moves day to day,
// so it's safe to cache far longer.
const FORECAST_CACHE_TTL_SECONDS = 60 * 60 * 2; // 2h
const HISTORICAL_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h

interface GeoResult {
  latitude: number;
  longitude: number;
}

async function geocode(city: string): Promise<GeoResult | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

interface DailyBlock {
  time: string[];
  weathercode: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max?: number[];
  precipitation_sum?: number[];
}

async function fetchForecast(geo: GeoResult, start: string, end: string): Promise<DayWeather[]> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&start_date=${start}&end_date=${end}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { daily?: DailyBlock };
  const daily = data.daily;
  if (!daily) return [];

  return daily.time.map((date, i) => ({
    date,
    isForecast: true,
    tempMaxC: Math.round(daily.temperature_2m_max[i]),
    tempMinC: Math.round(daily.temperature_2m_min[i]),
    precipitationChance: daily.precipitation_probability_max?.[i] ?? null,
    precipitationMm: null,
    condition: conditionFromWmoCode(daily.weathercode[i]),
  }));
}

function shiftYear(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y - years, m - 1, d));
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

async function fetchHistoricalAverage(geo: GeoResult, start: string, end: string): Promise<DayWeather[]> {
  const yearOffsets = Array.from({ length: ARCHIVE_YEARS }, (_, i) => i + 1);
  const perYear = await Promise.all(
    yearOffsets.map(async (years) => {
      const histStart = shiftYear(start, years);
      const histEnd = shiftYear(end, years);
      const res = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.latitude}&longitude=${geo.longitude}` +
          `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum` +
          `&timezone=auto&start_date=${histStart}&end_date=${histEnd}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { daily?: DailyBlock };
      return data.daily ?? null;
    })
  );

  const validYears = perYear.filter((d): d is DailyBlock => d !== null && d.time.length > 0);
  if (validYears.length === 0) return [];

  // Align by day-offset within the range (not by literal date, since each
  // year's dates differ) — every valid year should have the same number of
  // days for the same start/end month-day span.
  const dayCount = validYears[0].time.length;
  const tripDates = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(Date.UTC(...(start.split("-").map(Number) as [number, number, number])));
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  return tripDates.map((date, i) => {
    const maxes = validYears.map((y) => y.temperature_2m_max[i]).filter((v) => typeof v === "number");
    const mins = validYears.map((y) => y.temperature_2m_min[i]).filter((v) => typeof v === "number");
    const precips = validYears.map((y) => y.precipitation_sum?.[i]).filter((v): v is number => typeof v === "number");
    const conditions = validYears.map((y) => conditionFromWmoCode(y.weathercode[i]));

    const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

    return {
      date,
      isForecast: false,
      tempMaxC: Math.round(avg(maxes)),
      tempMinC: Math.round(avg(mins)),
      precipitationChance: null,
      precipitationMm: precips.length ? Math.round(avg(precips)) : null,
      condition: mostCommon(conditions),
    };
  });
}

async function weatherForDestination(city: string, start: string, end: string): Promise<DayWeather[]> {
  const geo = await geocode(city);
  if (!geo) return [];

  const useForecast = daysFromToday(start) >= 0 && daysFromToday(end) <= FORECAST_HORIZON_DAYS;
  return useForecast ? fetchForecast(geo, start, end) : fetchHistoricalAverage(geo, start, end);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const destinations = (searchParams.get("destinations") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const start = searchParams.get("start")?.trim();
  const end = searchParams.get("end")?.trim();

  if (destinations.length === 0 || !start || !end) {
    return NextResponse.json({}, { status: 400 });
  }

  const cacheKey = `weather:${destinations.join("|")}:${start}:${end}`;

  let redis;
  try {
    redis = getRedis();
  } catch {
    redis = null;
  }

  if (redis) {
    const cached = await redis.get<DestinationWeather | string>(cacheKey);
    if (cached) {
      const parsed = typeof cached === "string" ? (JSON.parse(cached) as DestinationWeather) : cached;
      return NextResponse.json(parsed);
    }
  }

  const result: DestinationWeather = {};
  await Promise.all(
    destinations.map(async (city) => {
      try {
        const days = await weatherForDestination(city, start, end);
        if (days.length > 0) result[city] = days;
      } catch {
        // Skip this destination — a partial weather outlook beats none.
      }
    })
  );

  if (redis && Object.keys(result).length > 0) {
    // All destinations share the same trip dates, so they're uniformly
    // forecast-or-historical together — checking any one day is enough to
    // pick the right TTL for the whole cached response.
    const isForecast = Object.values(result).some((days) => days[0]?.isForecast);
    const ttl = isForecast ? FORECAST_CACHE_TTL_SECONDS : HISTORICAL_CACHE_TTL_SECONDS;
    await redis.set(cacheKey, JSON.stringify(result), { ex: ttl });
  }

  return NextResponse.json(result);
}
