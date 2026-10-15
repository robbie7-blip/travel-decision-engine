// Run: npm run test:trip-map

import assert from "node:assert/strict";
import { projectCluster, tripMapClusters } from "./tripMap";

const at = (lat: number, lng: number, title: string, type = "activity") =>
  ({ time: "10:00", type, title, location: "", cost_estimate_eur: 0, reasoning: "", google_lat: lat, google_lng: lng }) as never;
const bare = { time: "10:00", type: "meal", title: "Somewhere unverified", location: "", cost_estimate_eur: 0, reasoning: "" } as never;

const days = [
  { day: 1, date: "2026-11-06", items: [at(41.9, 12.49, "Hotel", "lodging"), at(41.89, 12.492, "Colosseum"), bare, at(41.901, 12.483, "Trevi")] },
  { day: 2, date: "2026-11-07", items: [at(41.906, 12.454, "Vatican"), at(41.9, 12.47, "Navona")] },
  // Florence, 230 km away: its own panel.
  { day: 3, date: "2026-11-08", items: [at(43.773, 11.256, "Duomo"), at(43.768, 11.253, "Ponte Vecchio")] },
  // A day with one placed stop far from everything: no panel of its own.
  { day: 4, date: "2026-11-09", items: [at(45.44, 12.33, "Venice airport")] },
] as never;

const clusters = tripMapClusters(days);
assert.equal(clusters.length, 2, "Rome and Florence; the lone pin is not a map");
assert.deepEqual(clusters[0].days, [1, 2]);
assert.deepEqual(clusters[1].days, [3]);
const rome = clusters[0].points;
assert.equal(rome.length, 5, "unverified places are never drawn");
assert.deepEqual(rome.filter((p) => p.day === 1).map((p) => `${p.order}${p.title}`), ["0Hotel", "1Colosseum", "2Trevi"], "lodging is unnumbered");

// Malformed stored data does not throw.
assert.deepEqual(tripMapClusters([{ day: 1, items: [{ google_lat: "41", google_lng: null }] }] as never), []);
assert.deepEqual(tripMapClusters(undefined as never), []);

const plot = projectCluster(rome, 640);
assert.ok(plot.height >= 220 && plot.height <= 460);
for (const p of plot.xy) assert.ok(p.x >= 0 && p.x <= 640 && p.y >= 0 && p.y <= plot.height, "everything inside the box");
const north = rome.findIndex((p) => p.title === "Vatican");
const south = rome.findIndex((p) => p.title === "Colosseum");
assert.ok(plot.xy[north].y < plot.xy[south].y, "north is up");

console.log("tripMap: all assertions passed");
