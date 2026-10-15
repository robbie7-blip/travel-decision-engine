"use client";

// The whole trip on one map (lib/tripMap.ts): a panel per city, each day
// in its own colour, the order of each day as a dashed line. Drawn the
// same way as DayMap - no tiles, no third-party requests - so it shows
// the shape of the trip, which days are compact and which sprawl, at a
// glance, and works offline like the rest of the page.

import type { Dictionary } from "@/lib/i18n";
import type { ItineraryDay } from "@/lib/types";
import { projectCluster, tripMapClusters } from "@/lib/tripMap";

const WIDTH = 640;
const DAY_COLOURS = 6;

export function TripMap({ days, t }: { days: ItineraryDay[]; t: Dictionary }) {
  const clusters = tripMapClusters(days);
  // A trip whose every day already has its own day map gains nothing from
  // a single-day panel here.
  if (clusters.length === 0 || (clusters.length === 1 && clusters[0].days.length < 2)) return null;
  const colour = (day: number) => `var(--day-${((day - 1) % DAY_COLOURS) + 1})`;

  return (
    <section className="trip-map no-print" aria-labelledby="trip-map-heading">
      <h2 id="trip-map-heading" className="font-ui trip-map-heading">
        {t.result.tripMap.heading}
      </h2>
      {clusters.map((cluster, ci) => {
        const plot = projectCluster(cluster.points, WIDTH);
        const pts = cluster.points.map((p, i) => ({ ...p, ...plot.xy[i] }));
        const label =
          cluster.days.length === 1
            ? `${t.result.day} ${cluster.days[0]}`
            : `${t.result.day} ${cluster.days[0]}-${cluster.days[cluster.days.length - 1]}`;
        return (
          <figure key={ci} className="trip-map-panel">
            <svg
              viewBox={`0 0 ${WIDTH} ${plot.height}`}
              role="img"
              aria-label={t.result.tripMap.alt.replace("{days}", label)}
              className="day-map-svg"
            >
              <rect x="0" y="0" width={WIDTH} height={plot.height} fill="var(--bg-panel-raised)" />
              {cluster.days.map((day) => {
                const route = pts.filter((p) => p.day === day && !p.lodging);
                if (route.length < 2) return null;
                const d = route.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
                return (
                  <path
                    key={day}
                    d={d}
                    fill="none"
                    stroke={colour(day)}
                    strokeWidth="2"
                    strokeDasharray="6 5"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                );
              })}
              {pts.map((p, i) =>
                p.lodging ? (
                  <rect key={i} x={p.x - 7} y={p.y - 7} width="14" height="14" rx="3" fill="var(--bg-panel)" stroke="var(--brand-gold-ink)" strokeWidth="2.5" />
                ) : (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="11" fill={colour(p.day)} stroke="var(--bg-panel)" strokeWidth="1.5" />
                    <text x={p.x} y={p.y + 4} textAnchor="middle" className="trip-map-pin-label" fill="#ffffff">
                      {p.order}
                    </text>
                  </g>
                )
              )}
            </svg>
            <figcaption className="day-map-legend font-ui">
              {cluster.days.map((day) => (
                <span key={day} className="day-map-legend-item">
                  <span className="trip-map-swatch" style={{ background: colour(day) }} aria-hidden />
                  {t.result.day} {day}
                </span>
              ))}
              <span className="day-map-legend-item">
                <span className="trip-map-swatch trip-map-swatch-stay" aria-hidden />
                {t.result.tripMap.stay}
              </span>
            </figcaption>
          </figure>
        );
      })}
      <p className="font-ui trip-map-note">{t.result.tripMap.note}</p>
    </section>
  );
}
