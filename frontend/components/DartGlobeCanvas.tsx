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
import { dartFlightMs, type DartHit } from "@/lib/dartGlobe";
import { CANVAS_COLORS } from "@/lib/theme";

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
const IDLE_ALTITUDE = 1.8;
const HIT_ALTITUDE = 0.9;
/** Closer, for the countries with no outline to light up.
 *
 * Monaco is two square kilometres and Tuvalu twenty-six. At the altitude
 * that frames Brazil nicely, the marker for one of those is a dot in an
 * expanse of blue with nothing highlighted behind it - the country cannot
 * be coloured because the topology has no shape for it (see
 * lib/countryPoints.ts). Coming in closer is what makes the answer legible
 * rather than a pin in the sea. */
const POINT_HIT_ALTITUDE = 0.35;

/** Where the dart starts, in globe radii above the surface.
 *
 * High enough to be clearly off the globe when the camera starts moving,
 * low enough that it is already in frame rather than arriving from
 * somewhere the viewer never saw it. */
const DART_START_ALTITUDE = 1.15;

/** The dart, in react-globe.gl's scene units, where the globe's radius is
 * 100. Eleven units long is about a tenth of the radius: big enough to
 * read as a dart on a phone, small enough not to look like a missile.
 *
 * Built nose along +Z, body trailing into -Z, because positioning is done
 * by getCoords and then lookAt(0,0,0) - which aims local +Z at the centre
 * of the globe. Build it along +Y like a cone's default and the dart flies
 * sideways. */
function makeDart(): THREE.Group {
  const dart = new THREE.Group();

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(1.3, 4.5, 14),
    new THREE.MeshPhongMaterial({ color: CANVAS_COLORS.accent1 })
  );
  // A cone points along +Y, so rotating +90 degrees about X turns the nose
  // to +Z, which is the direction lookAt will aim at the globe.
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 3.2;
  dart.add(tip);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 7, 10),
    new THREE.MeshPhongMaterial({ color: CANVAS_COLORS.inkDim })
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -2.5;
  dart.add(shaft);

  // Three flights at the tail, so the dart reads as a dart from any angle
  // the camera happens to be at rather than only side-on.
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 2.4, 2.6),
      new THREE.MeshPhongMaterial({ color: CANVAS_COLORS.accentGreen })
    );
    fin.position.z = -5.4;
    fin.rotation.z = (i * 2 * Math.PI) / 3;
    fin.position.y = Math.cos((i * 2 * Math.PI) / 3) * 1.1;
    fin.position.x = Math.sin((i * 2 * Math.PI) / 3) * 1.1;
    dart.add(fin);
  }

  // Hidden until a throw. The object exists for the life of the component
  // (see the customLayerData note below), so it has to start invisible or
  // a dart sits at the centre of the globe before anything is thrown.
  dart.visible = false;
  return dart;
}

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

  /** True while the dart is in the air, which is what decides whether the
   * page is showing a dart flying or a dart stuck.
   *
   * Kept here rather than read from GlobeDart's own `inFlight` because the
   * canvas is what knows when the flight is over - it owns the timer that
   * calls onArrived - and two components timing the same animation from
   * different clocks is how a dart ends up stuck in the air. */
  const [flying, setFlying] = useState(false);
  /** The dart object itself, captured when three.js builds it, so the
   * animation can move it without a React render per frame. */
  const dartRef = useRef<THREE.Group | null>(null);

  // Fly to the hit. Keyed on throwId as well as the hit itself so throwing
  // again and landing on the same country still moves the camera.
  //
  // Two things move together: the camera swings to the landing point while
  // the dart falls toward it, so they arrive at the same moment. The dart
  // used to be simply PRESENT from the first frame - the camera moved and
  // the pin was already stuck in the country before the viewer could see
  // it happen, which is a camera move rather than a throw.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || size === 0 || !hit) return;
    const ms = dartFlightMs(reducedMotion);
    const altitude = hit.insideBorder ? HIT_ALTITUDE : POINT_HIT_ALTITUDE;
    globe.pointOfView({ lat: hit.lat, lng: hit.lng, altitude }, ms);
    setFlying(true);

    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      // Clamped, because a backgrounded tab can hand back a timestamp well
      // past the end and a negative altitude puts the dart inside the
      // globe, where it is both invisible and wrong.
      const t = Math.min(1, Math.max(0, (now - startedAt) / ms));
      // Accelerating, not linear: a dart does not fall at a constant rate,
      // and the camera is still settling for the first half of this.
      const eased = t * t;
      const dart = dartRef.current;
      if (dart) {
        dart.visible = true;
        const alt = DART_START_ALTITUDE * (1 - eased);
        const { x, y, z } = globe.getCoords(hit.lat, hit.lng, alt);
        dart.position.set(x, y, z);
        // Nose at the globe's centre, which is "straight down" anywhere on
        // a sphere.
        dart.lookAt(0, 0, 0);
      }
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    const timer = setTimeout(() => {
      // The stuck pin takes over from here, so the flying dart goes away.
      // Both on screen at once would read as two darts.
      if (dartRef.current) dartRef.current.visible = false;
      setFlying(false);
      arrived.current();
    }, ms);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
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

  // The stuck pin and the impact ring both wait for the landing. They used
  // to appear on the first frame of the throw, which told the viewer where
  // the dart had landed while it was still notionally in the air.
  const points = useMemo(
    () => (hit && !flying ? [{ lat: hit.lat, lng: hit.lng }] : []),
    [hit, flying]
  );
  // One ring, expanding, as the impact. Re-created per throw so it replays.
  const rings = useMemo(
    () => (hit && !flying ? [{ lat: hit.lat, lng: hit.lng, id: throwId }] : []),
    [hit, throwId, flying]
  );
  /** The dart layer's data: ONE item, constant for the life of the
   * component.
   *
   * Deliberately not keyed on the throw. Keyed per throw, three-globe
   * treats each one as new data and builds a fresh three.js object, which
   * leaves a window on the second throw where the animation is still
   * moving the object from the FIRST one - already removed from the scene
   * - while the new one sits unpositioned at the centre of the globe. One
   * stable item means one object, created once, and the ref the animation
   * holds is never stale.
   *
   * Visibility is what hides it between throws, not presence. */
  const darts = useMemo(() => [{ id: "dart" }], []);

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
          customLayerData={darts}
          customThreeObject={() => {
            const dart = makeDart();
            dartRef.current = dart;
            return dart;
          }}
          // The animation moves the object directly, so there is nothing
          // to do per data change. Declared anyway: without it the library
          // re-creates the object on every update, which would drop the
          // ref the animation is holding.
          customThreeObjectUpdate={() => {}}
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
