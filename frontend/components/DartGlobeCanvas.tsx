"use client";

// The globe the dart is thrown at.
//
// Separate from VisitedGlobe rather than a prop on it: that component keeps
// its Globe ref private and is built around clicking countries to toggle
// them visited, while this one needs to DRIVE the camera to a point and has
// no click behaviour at all. Everything else follows it deliberately - the
// same WORLD_COUNTRY_FEATURES topology, the same hardcoded CANVAS_COLORS
// (this renders to WebGL, which cannot resolve CSS custom properties), and
// the same ResizeObserver sizing rather than trusting the library's own
// auto-sizing, which that file's header records as not trustworthy on real
// mobile browsers.
//
// Must only ever be loaded through next/dynamic(..., { ssr: false }) -
// three.js touches document at construction time and throws during SSR.
// GlobeDart does that; nothing else should import this directly.

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { WORLD_COUNTRY_FEATURES, type CountryFeature } from "@/lib/worldGeo";
import { CANVAS_COLORS } from "@/lib/theme";
import type { DartHit } from "@/lib/dartGlobe";

interface DartGlobeCanvasProps {
  /** Where the dart is stuck, or null before the first throw. */
  hit: DartHit | null;
  /** Bumped on every throw, so the same country twice still re-animates. */
  throwId: number;
  /** Honoured by shortening the camera move, not by skipping it - the
   * lesson from the wheel, where a blanket `transition: none` under this
   * preference turned a spin into a teleport and read as broken. */
  reducedMotion: boolean;
  /** Called once the camera has arrived, so the result card appears with
   * the dart rather than before it. */
  onArrived: () => void;
}

/** How long the camera takes to swing to the hit, and how close it gets.
 *
 * Altitude is in globe radii. The library's own default of 2.5 leaves the
 * sphere small in its frame - measured at a 390px phone width, the globe
 * occupied about half the canvas it was given, with the rest empty page.
 * 1.8 fills the frame at rest; 0.9 is close enough to read a country's
 * shape without losing the sense that it is a globe. */
const FLIGHT_MS = 1600;
const REDUCED_FLIGHT_MS = 450;
const IDLE_ALTITUDE = 1.8;
const HIT_ALTITUDE = 0.9;

export default function DartGlobeCanvas({ hit, throwId, reducedMotion, onArrived }: DartGlobeCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState(0);
  const arrived = useRef(onArrived);
  arrived.current = onArrived;

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setSize(Math.floor(Math.min(width, 520)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Idle: a slow turn, so the globe reads as a globe rather than a picture
  // of one. Stopped the moment a dart is in the air - a target that is
  // still moving when it is hit would undercut the whole point.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || size === 0) return;
    const controls = globe.controls() as { autoRotate: boolean; autoRotateSpeed: number };
    controls.autoRotate = hit === null && !reducedMotion;
    controls.autoRotateSpeed = 0.35;
  }, [hit, size, reducedMotion]);

  // Fly to the hit. Keyed on throwId as well as the hit itself so throwing
  // again and landing on the same country still moves the camera.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || size === 0 || !hit) return;
    const ms = reducedMotion ? REDUCED_FLIGHT_MS : FLIGHT_MS;
    globe.pointOfView({ lat: hit.lat, lng: hit.lng, altitude: HIT_ALTITUDE }, ms);
    const timer = setTimeout(() => arrived.current(), ms);
    return () => clearTimeout(timer);
  }, [hit, throwId, size, reducedMotion]);

  // The opening shot: the whole world, once, on mount. Set through the ref
  // because <Globe> has no initial point-of-view prop.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || size === 0) return;
    globe.pointOfView({ altitude: IDLE_ALTITUDE }, 0);
  }, [size]);

  const globeMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: CANVAS_COLORS.bgPanel }), []);

  // The country the dart is in, lit up. Recomputed rather than stored so it
  // cannot disagree with `hit`.
  const hitCode = hit?.code ?? null;

  const points = useMemo(() => (hit ? [{ lat: hit.lat, lng: hit.lng }] : []), [hit]);
  // One ring, expanding, as the impact. Re-created per throw so it replays.
  const rings = useMemo(
    () => (hit ? [{ lat: hit.lat, lng: hit.lng, id: throwId }] : []),
    [hit, throwId]
  );

  return (
    // min-width, not just width:100%, and this is the whole reason the
    // canvas failed to appear at all on the first attempt.
    //
    // .spin's first grid track is `minmax(0, 420px)` - maximum 420, MINIMUM
    // ZERO. The wheel filled it only because an <svg> carries a 300px
    // default intrinsic width, so the track had a base size to resolve
    // against. An empty div at width:100% has no intrinsic width, the track
    // collapsed to 0, the ResizeObserver reported 0, and `size > 0` never
    // became true - no canvas, no error, no clue. A floor here gives the
    // track something to be.
    <div
      ref={wrapperRef}
      className="spin-globe"
      style={{ width: "100%", minWidth: 260, display: "flex", justifyContent: "center", overflow: "hidden" }}
    >
      {size > 0 && (
        <Globe
          ref={globeRef}
          width={size}
          height={size}
          backgroundColor="rgba(0,0,0,0)"
          showAtmosphere
          atmosphereColor={CANVAS_COLORS.accentGreen}
          atmosphereAltitude={0.18}
          globeMaterial={globeMaterial}
          polygonsData={WORLD_COUNTRY_FEATURES}
          polygonCapColor={(feat: object) => {
            const f = feat as CountryFeature;
            return f.properties.I.toUpperCase() === hitCode
              ? CANVAS_COLORS.accentGreen
              : CANVAS_COLORS.lineStrong;
          }}
          polygonSideColor={() => "rgba(0,0,0,0)"}
          polygonStrokeColor={() => CANVAS_COLORS.inkDim}
          polygonAltitude={(feat: object) =>
            (feat as CountryFeature).properties.I.toUpperCase() === hitCode ? 0.02 : 0.006
          }
          pointsData={points}
          pointLat="lat"
          pointLng="lng"
          pointColor={() => CANVAS_COLORS.accent1}
          pointAltitude={0.06}
          pointRadius={0.5}
          ringsData={rings}
          ringLat="lat"
          ringLng="lng"
          ringColor={() => () => CANVAS_COLORS.accent1}
          ringMaxRadius={4}
          ringPropagationSpeed={3}
          ringRepeatPeriod={700}
        />
      )}
    </div>
  );
}
