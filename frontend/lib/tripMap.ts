// The whole trip on a map, as data: every verified place, which day it is
// on, grouped by city, projected to a plot.
//
// GROUPED BY CITY because a Rome-Florence-Venice trip drawn on one plot is
// three dots: the days inside each city are a few kilometres across and
// the cities are hundreds apart. So places more than CLUSTER_KM from every
// other place in a group start a new group, and each group gets its own
// panel - the days in it, each in its own colour.
//
// Same rules as DayMap: only places Google Places verified carry
// coordinates, and only those are drawn - a pin is a claim that the place
// is where the pin says.
//
// Run: npm run test:trip-map

import type { ItineraryDay } from "./types";

export interface TripMapPoint {
  day: number;
  /** Position within its day among the places drawn, from 1. */
  order: number;
  lat: number;
  lng: number;
  title: string;
  lodging: boolean;
}

export interface TripMapCluster {
  days: number[];
  points: TripMapPoint[];
}

const CLUSTER_KM = 40;
const M_PER_DEG_LAT = 111_320;

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * M_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLng) / 1000;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function tripMapClusters(days: ItineraryDay[]): TripMapCluster[] {
  const points: TripMapPoint[] = [];
  for (const day of days ?? []) {
    let order = 0;
    for (const item of day.items ?? []) {
      if (!finite(item.google_lat) || !finite(item.google_lng)) continue;
      const lodging = item.type === "lodging";
      if (!lodging) order++;
      const title = typeof item.venue_name === "string" && item.venue_name ? item.venue_name : typeof item.title === "string" ? item.title : "";
      points.push({ day: day.day, order: lodging ? 0 : order, lat: item.google_lat, lng: item.google_lng, title, lodging });
    }
  }

  const clusters: TripMapCluster[] = [];
  for (const p of points) {
    const home = clusters.find((c) => c.points.some((q) => km(p, q) <= CLUSTER_KM));
    if (home) home.points.push(p);
    else clusters.push({ days: [], points: [p] });
  }
  for (const c of clusters) c.days = [...new Set(c.points.map((p) => p.day))].sort((a, b) => a - b);
  // A panel is worth drawing when it says something about shape: two
  // places at least. A lone airport pin is not a map.
  return clusters.filter((c) => c.points.length >= 2);
}

/** Plot coordinates for a cluster: true aspect ratio (one scale on both
 * axes), north up, padded, height following the data within limits. */
export function projectCluster(
  points: TripMapPoint[],
  width: number,
  { pad = 36, minHeight = 220, maxHeight = 460, minSpanM = 600 } = {}
): { height: number; scale: number; xy: { x: number; y: number }[] } {
  const midLat = (Math.min(...points.map((p) => p.lat)) + Math.max(...points.map((p) => p.lat))) / 2;
  const mPerLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const xs = points.map((p) => p.lng * mPerLng);
  const ys = points.map((p) => p.lat * M_PER_DEG_LAT);
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), minSpanM);
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), minSpanM);
  const usableW = width - pad * 2;
  const height = Math.round(Math.min(maxHeight, Math.max(minHeight, usableW * (spanY / spanX) + pad * 2)));
  const scale = Math.min(usableW / spanX, (height - pad * 2) / spanY);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return {
    height,
    scale,
    xy: points.map((_, i) => ({ x: width / 2 + (xs[i] - cx) * scale, y: height / 2 - (ys[i] - cy) * scale })),
  };
}
