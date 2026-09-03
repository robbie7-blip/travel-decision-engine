"use client";

// One day of an itinerary, drawn as a shape.
//
// A day in a city is a route, and until now the product rendered it as a
// list of times. The coordinates for every verified venue were already
// being fetched from Google Places and discarded (see applyPlaceData in
// worker/src/engine/venueVerification.ts); this is what they are for.
//
// Deliberately NOT a tiled map. No Leaflet, no Mapbox, no OpenStreetMap
// raster tiles: a tile layer means a third-party request per tile on every
// page view, an attribution bar, a usage policy, and a visual style that is
// somebody else's. What actually helps a traveler here is not street names
// they will read on their phone anyway - it is the shape of the day. Are
// these five places clustered or strung across the city? Does the evening
// double back? A flat plot answers that in one glance and costs nothing to
// serve.
//
// The scale bar is the honesty part. Without it a tight cluster and a
// cross-city sprawl look identical, because the plot always fills its box.

import { useId } from "react";
import type { ItineraryItem } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n";

interface Placed {
  item: ItineraryItem;
  lat: number;
  lng: number;
  /** Position in the day, which is what the numbered pin shows. */
  order: number;
}

const WIDTH = 640;
/** The box adapts to the day instead of being a fixed letterbox. A compact
 * morning in one neighbourhood and a day strung across a city are different
 * shapes, and forcing both into 640x320 left one of them floating in empty
 * space. Clamped so a single street does not become a tall thin sliver and
 * a cross-city day does not become a wall. */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 420;
const PAD = 40;

/** Metres per degree of latitude, near enough anywhere. Longitude degrees
 * shrink towards the poles, which is why the x axis is scaled by
 * cos(latitude) below - without it a day in Reykjavik comes out stretched
 * sideways and the scale bar lies. */
const M_PER_DEG_LAT = 111_320;

function metresPerDegLng(latDeg: number): number {
  return M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/** A round number of metres that fits comfortably inside the plot, for the
 * scale bar. Prefers 1/2/5 steps, the way any map scale does. */
function niceDistance(metres: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(metres)));
  const norm = metres / pow;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * pow;
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

export function DayMap({ items, t }: { items: ItineraryItem[]; t: Dictionary }) {
  const gradientId = useId();

  // Only verified venues carry coordinates, and lodging is excluded from
  // the numbering because "the hotel" is not a stop on the route - it is
  // where the route starts and ends. It still gets a pin, just an unnumbered
  // one.
  const placed: Placed[] = [];
  let order = 0;
  for (const item of items) {
    if (typeof item.google_lat !== "number" || typeof item.google_lng !== "number") continue;
    const isLodging = item.type === "lodging";
    if (!isLodging) order += 1;
    placed.push({ item, lat: item.google_lat, lng: item.google_lng, order: isLodging ? 0 : order });
  }

  // Two points is the minimum that says anything about shape. One pin on
  // an empty rectangle is decoration, so it renders nothing.
  if (placed.length < 2) return null;

  const lats = placed.map((p) => p.lat);
  const lngs = placed.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mPerLng = metresPerDegLng(midLat);

  // Project to metres first, so the aspect ratio is true and the scale bar
  // means the same thing on both axes.
  const xs = placed.map((p) => p.lng * mPerLng);
  const ys = placed.map((p) => p.lat * M_PER_DEG_LAT);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // A minimum span stops two venues on the same street from being blown up
  // to fill the box, which would read as a cross-town trek.
  const MIN_SPAN_M = 400;
  const spanX = Math.max(maxX - minX, MIN_SPAN_M);
  const spanY = Math.max(maxY - minY, MIN_SPAN_M);

  const usableW = WIDTH - PAD * 2;
  // Height follows the data's own aspect ratio, so the plot fills its box
  // in both directions and the scale stays the same on both axes. One
  // scale for both is the point: squashing an axis to fill the frame is
  // exactly the lie the scale bar exists to prevent.
  const height = Math.round(
    Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, usableW * (spanY / spanX) + PAD * 2))
  );
  const usableH = height - PAD * 2;
  const scale = Math.min(usableW / spanX, usableH / spanY);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  const points = placed.map((p) => ({
    ...p,
    x: WIDTH / 2 + (p.lng * mPerLng - centreX) * scale,
    // SVG y grows downwards; north should be up.
    y: height / 2 - (p.lat * M_PER_DEG_LAT - centreY) * scale,
  }));

  const route = points.filter((p) => p.item.type !== "lodging");
  const path = route.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const barMetres = niceDistance((spanX * 0.35) || MIN_SPAN_M);
  const barPx = barMetres * scale;

  // A faint grid at the scale bar's own interval. It gives the plot the
  // texture of a map rather than a scatter chart, and it does real work:
  // one square is one scale-bar unit, so the spacing between two pins can
  // be read off the grid without measuring against the bar.
  const gridLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let x = WIDTH / 2; x < WIDTH; x += barPx) {
    gridLines.push({ x1: x, y1: 0, x2: x, y2: height });
    if (x !== WIDTH / 2) gridLines.push({ x1: WIDTH - x, y1: 0, x2: WIDTH - x, y2: height });
  }
  for (let y = height / 2; y < height; y += barPx) {
    gridLines.push({ x1: 0, y1: y, x2: WIDTH, y2: y });
    if (y !== height / 2) gridLines.push({ x1: 0, y1: height - y, x2: WIDTH, y2: height - y });
  }

  return (
    <figure className="day-map">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={t.result.map.alt} className="day-map-svg">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bg-panel)" />
            <stop offset="1" stopColor="var(--bg-panel-raised)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={WIDTH} height={height} fill={`url(#${gradientId})`} />

        <g stroke="var(--line)" strokeWidth="1" opacity="0.7">
          {gridLines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
          ))}
        </g>

        {/* The walking line, dashed because it is the order of the day, not
            a claim about which streets to take. */}
        <path
          d={path}
          fill="none"
          stroke="var(--brand-teal)"
          strokeWidth="2"
          strokeDasharray="6 5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />

        {points.map((p, i) => {
          const isLodging = p.item.type === "lodging";
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isLodging ? 9 : 13}
                fill={isLodging ? "var(--bg-panel)" : "var(--brand-teal)"}
                stroke={isLodging ? "var(--brand-gold-ink)" : "var(--brand-teal)"}
                strokeWidth="2"
              />
              {!isLodging && (
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  className="day-map-pin-label"
                  fill="var(--bg-panel)"
                >
                  {p.order}
                </text>
              )}
            </g>
          );
        })}

        {/* Scale bar. Without it every day looks the same size. */}
        <g transform={`translate(${PAD}, ${height - 18})`}>
          <line x1="0" y1="0" x2={barPx} y2="0" stroke="var(--ink-dim)" strokeWidth="1.5" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="var(--ink-dim)" strokeWidth="1.5" />
          <line x1={barPx} y1="-4" x2={barPx} y2="4" stroke="var(--ink-dim)" strokeWidth="1.5" />
          <text x={barPx + 8} y="4" className="day-map-scale" fill="var(--ink-dim)">
            {formatDistance(barMetres)}
          </text>
        </g>
      </svg>

      {/* The legend is the map's caption in text, which is also what a
          screen reader gets instead of the plot. */}
      <figcaption className="day-map-legend font-ui">
        {route.map((p) => (
          <span key={p.order} className="day-map-legend-item">
            <span className="day-map-legend-number">{p.order}</span>
            {p.item.venue_name || p.item.title}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
