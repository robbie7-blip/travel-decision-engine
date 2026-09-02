"use client";

import { useEffect, useState } from "react";
import { SectionLabel } from "./ui";
import type { Dictionary } from "@/lib/i18n";
import type { DestinationWeather, WeatherCondition } from "@/lib/weather";
import type { Language } from "@/lib/types";

function WeatherIcon({ condition }: { condition: WeatherCondition }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (condition) {
    case "clear":
      return (
        <svg {...common} stroke="var(--accent-2)">
          <circle cx="12" cy="12" r="5" strokeWidth="1.8" />
          <path strokeWidth="1.8" d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19 5l-1.8 1.8M6.8 17.2 5 19M19 19l-1.8-1.8M6.8 6.8 5 5" />
        </svg>
      );
    case "partly-cloudy":
      return (
        <svg {...common} stroke="var(--ink-dim)">
          <circle cx="8" cy="9" r="3.5" strokeWidth="1.6" stroke="var(--accent-2)" />
          <path strokeWidth="1.6" d="M9 20h9a3.5 3.5 0 0 0 .3-6.98A5 5 0 0 0 9 12" />
        </svg>
      );
    case "cloudy":
      return (
        <svg {...common} stroke="var(--ink-dim)">
          <path strokeWidth="1.6" d="M6 18h11a3.5 3.5 0 0 0 .3-6.98A5.5 5.5 0 0 0 6.6 9.5 4 4 0 0 0 6 18Z" />
        </svg>
      );
    case "fog":
      return (
        <svg {...common} stroke="var(--ink-dim)">
          <path strokeWidth="1.6" d="M6 14h11a3.5 3.5 0 0 0 .2-6.98A5.5 5.5 0 0 0 6.6 5.7" />
          <path strokeWidth="1.6" d="M4 18h16M4 21h12" />
        </svg>
      );
    case "rain":
      return (
        <svg {...common} stroke="var(--ink-dim)">
          <path strokeWidth="1.6" d="M6 13h11a3.5 3.5 0 0 0 .2-6.98A5.5 5.5 0 0 0 6.6 4.7" />
          <path stroke="var(--grounded)" strokeWidth="1.6" d="M8 17.5 6.8 20M12.5 17.5l-1.2 2.5M17 17.5l-1.2 2.5" />
        </svg>
      );
    case "snow":
      return (
        <svg {...common} stroke="var(--ink-dim)">
          <path strokeWidth="1.6" d="M6 13h11a3.5 3.5 0 0 0 .2-6.98A5.5 5.5 0 0 0 6.6 4.7" />
          <path stroke="var(--grounded)" strokeWidth="1.6" d="M8 17.5v4M6.3 19h3.4M12.5 17.5v4M10.8 19h3.4M17 17.5v4M15.3 19h3.4" />
        </svg>
      );
    case "thunderstorm":
      return (
        <svg {...common} stroke="var(--ink-dim)">
          <path strokeWidth="1.6" d="M6 12h11a3.5 3.5 0 0 0 .2-6.98A5.5 5.5 0 0 0 6.6 3.7" />
          <path stroke="var(--accent-1)" strokeWidth="1.6" d="m13 15-2.5 4h3L11 23" />
        </svg>
      );
  }
}

function useWeather(destinations: string[], startDate: string, endDate: string): DestinationWeather | null {
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
        if (!cancelled) setWeather({});
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.join(","), startDate, endDate]);

  return weather;
}

// Bug fixed: this used to be a single module-level formatter hardcoded to
// "en" regardless of the app's selected language - every forecast day
// label ("Mon, 12 Aug") showed English weekday/month abbreviations even
// when the rest of the page was in Bulgarian. Same LOCALE_BY_LANGUAGE
// pattern as DateRangePicker/SingleDatePicker, keyed per-language so the
// formatter itself follows the site's language choice.
const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: "en-GB",
  bg: "bg-BG",
};

export function WeatherStrip({
  destinations,
  startDate,
  endDate,
  t,
  language = "en",
}: {
  destinations: string[];
  startDate: string;
  endDate: string;
  t: Dictionary;
  language?: Language;
}) {
  const weather = useWeather(destinations, startDate, endDate);
  const weekdayFormatter = new Intl.DateTimeFormat(LOCALE_BY_LANGUAGE[language], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  if (!weather || Object.keys(weather).length === 0) return null;

  const anyHistorical = Object.values(weather).some((days) => days.some((d) => !d.isForecast));

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionLabel>{t.result.weather.heading}</SectionLabel>
      {anyHistorical && (
        <p style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.5, margin: "0 0 10px" }}>
          {t.result.weather.historicalNote}
        </p>
      )}
      {Object.entries(weather).map(([city, days]) => (
        <div key={city} style={{ marginBottom: 12 }}>
          {Object.keys(weather).length > 1 && (
            <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 6 }}>
              {city.toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {days.map((day) => (
              <div
                key={day.date}
                style={{
                  flexShrink: 0,
                  minWidth: 88,
                  padding: "10px 8px",
                  background: "var(--bg-panel-raised)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                <div className="font-ui" style={{ fontSize: 10, color: "var(--ink-dim)", marginBottom: 4 }}>
                  {weekdayFormatter.format(new Date(`${day.date}T12:00:00Z`))}
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
                  <WeatherIcon condition={day.condition} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {day.tempMaxC}° <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}>{day.tempMinC}°</span>
                </div>
                <div className="font-ui" style={{ fontSize: 10, color: "var(--grounded)", marginTop: 2 }}>
                  {day.precipitationChance != null
                    ? `${t.result.weather.rainChance}: ${day.precipitationChance}%`
                    : day.precipitationMm != null
                      ? `${t.result.weather.avgRain}: ${day.precipitationMm}mm`
                      : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
