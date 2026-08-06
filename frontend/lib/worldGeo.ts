// GeoJSON country shapes for the 3D globe (components/VisitedGlobe.tsx) —
// deliberately the SAME source data as the flat map (VisitedMap.tsx /
// react-svg-worldmap), not a second, independently-sourced world dataset.
//
// react-globe.gl needs raw GeoJSON polygons, and the obvious path (a
// separate package like world-atlas) turned out to be a real accuracy risk:
// world-atlas keys countries by ISO 3166-1 NUMERIC id, which would need a
// hand-built numeric->alpha-2 crosswalk table for all ~200 tracked
// countries (including non-standard ones like Kosovo/Taiwan/Vatican/
// Palestine) with no way to verify each entry here — exactly the kind of
// silent, hard-to-notice bug (a country colored wrong, or not at all) this
// app already got bitten by once with the flat map's contrast issue.
//
// react-svg-worldmap already has an alpha-2-keyed topology bundled inside
// it (verified against the flat map, which is already live and correct)
// but doesn't export the raw data — only the rendered React component and
// a flat `regions` list. worldTopology.json alongside this file is that
// same topology, extracted once (see the extraction note in that file's
// git history) so both map views draw from one proven-correct geometry
// source instead of two.

import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "./worldTopology.json";

export interface CountryFeature {
  type: "Feature";
  properties: { N: string; I: string }; // N = name, I = ISO alpha-2 code (matches react-svg-worldmap's own shape)
  geometry: GeoJSON.Geometry;
}

// Computed once per module load (not per-render) — the conversion itself is
// cheap, but there's no reason to redo it on every globe re-render either.
const topology = worldTopology as unknown as Topology;
const collection = feature(
  topology,
  topology.objects.countries as GeometryCollection
) as unknown as { type: "FeatureCollection"; features: CountryFeature[] };

export const WORLD_COUNTRY_FEATURES: CountryFeature[] = collection.features;
