"use client";

// The trip's forecast, fetched once.
//
// Lifted out of components/WeatherStrip, which owned it privately, because
// a second reader arrived: the packing list is derived from the same
// forecast (lib/packing.ts), and two components each calling this hook
// would have made the trip page fetch /api/weather twice for one answer.
// ItineraryResult calls it and hands the result to both.

import { useEffect, useState } from "react";
import type { DestinationWeather } from "./weather";

export function useWeather(
  destinations: string[],
  startDate: string,
  endDate: string
): DestinationWeather | null {
  const [weather, setWeather] = useState<DestinationWeather | null>(null);

  useEffect(() => {
    if (destinations.length === 0 || !startDate || !endDate) return;
    let cancelled = false;

    fetch(`/api/weather?destinations=${encodeURIComponent(destinations.join(","))}&start=${startDate}&end=${endDate}`)
      .then((res) => res.json())
      .then((data: DestinationWeather) => {
        if (!cancelled) setWeather(data);
      })
      .catch(() => {
        // An empty object rather than null: null means "still loading" to
        // every caller, so a failed fetch has to resolve into "asked, got
        // nothing" or the strip spins for ever.
        if (!cancelled) setWeather({});
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.join(","), startDate, endDate]);

  return weather;
}
