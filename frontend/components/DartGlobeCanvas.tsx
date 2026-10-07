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
import {
  dartFlightFrame,
  dartFlightMs,
  dartFlightPath,
  dartPointAt,
  dartTangentAt,
  dartThrowScale,
  revealedHit,
  type DartHit,
} from "@/lib/dartGlobe";
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

/** How big the dart is drawn at HIT_ALTITUDE, as a multiple of the profiles
 * below - which are about 13 units long, an eighth of the globe's radius.
 *
 * Scaled at throw time by dartThrowScale, because the camera finishes at
 * 0.9 radii for a country with an outline and 0.35 for one without. At the
 * close altitude the camera is 35 units above the ground, so a dart sized
 * for the far one is longer than the gap it has to fall through. */
const DART_SCALE = 2.7;

/** The dart's silhouette as a profile revolved about its axis: radius and
 * distance along the axis, nose first.
 *
 * Three pieces rather than one, because a dart is three materials and the
 * joins are what make it read as a dart rather than a rocket: a steel
 * needle, a weighted barrel that bulges in the middle where it is held,
 * and a thin stem behind it carrying the flights. What was here before was
 * a cone stuck on a cylinder with three boxes for fins, which was honest
 * about being a placeholder.
 *
 * Built nose along +Z, body trailing into -Z, because the flight aims the
 * nose by lookAt - which points local +Z at the target. A lathe revolves
 * around +Y, hence the rotateX on each one; build it along +Y and the dart
 * flies sideways. */
const DART_NEEDLE: [number, number][] = [
  [0, 6.5],
  [0.16, 5.6],
  [0.2, 4.6],
  [0.24, 4],
];
const DART_BARREL: [number, number][] = [
  [0.24, 4],
  [0.8, 3.3],
  [1.02, 2],
  [1.05, 0.2],
  [0.92, -1.2],
  [0.55, -2],
  [0.32, -2.4],
];
const DART_STEM: [number, number][] = [
  [0.32, -2.4],
  [0.3, -5.6],
  [0.44, -5.9],
  [0.3, -6.2],
  [0, -6.3],
];
/** Grip rings on the barrel, where a hand would be. */
const DART_GRIP_RINGS = [1.9, 0.9, -0.1];
/** One flight, as a quadrilateral in the plane containing the axis:
 * distance out from the stem against distance along it. Four of these in a
 * cross, which is what a real dart carries. */
const DART_FLIGHT: [number, number][] = [
  [0.3, -3],
  [1.6, -3.9],
  [2.35, -5.5],
  [0.3, -6],
];

function dartLathe(profile: [number, number][], color: string): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, along]) => new THREE.Vector2(radius, along)),
    18
  );
  geometry.rotateX(Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color, shininess: 40 }));
}

/** A flight, as two triangles.
 *
 * DoubleSide is not optional: a flight has no thickness, and a
 * single-sided one disappears for half of every turn the dart makes about
 * its own axis. */
function dartVane(color: string): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const [a, b, c, d] = DART_FLIGHT;
  const vertices: number[] = [];
  for (const triangle of [
    [a, b, c],
    [a, c, d],
  ]) {
    for (const [out, along] of triangle) vertices.push(out, 0, along);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide })
  );
}

function makeDart(): THREE.Group {
  const dart = new THREE.Group();
  dart.add(dartLathe(DART_NEEDLE, CANVAS_COLORS.inkDim));
  dart.add(dartLathe(DART_BARREL, CANVAS_COLORS.accent1));
  dart.add(dartLathe(DART_STEM, CANVAS_COLORS.inkDim));

  for (const along of DART_GRIP_RINGS) {
    const geometry = new THREE.CylinderGeometry(1.1, 1.1, 0.2, 18);
    geometry.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(
      geometry,
      new THREE.MeshPhongMaterial({ color: CANVAS_COLORS.bgPanelRaised })
    );
    ring.position.z = along;
    dart.add(ring);
  }

  for (let i = 0; i < 4; i++) {
    const flight = dartVane(CANVAS_COLORS.accentGreen);
    flight.rotation.z = (i * Math.PI) / 2;
    dart.add(flight);
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
  // The camera swings to the landing point first, and the dart is thrown
  // into the second half of that window - see the long note on the throw
  // in lib/dartGlobe.ts. The dart used to be simply PRESENT from the first
  // frame, with the pin already stuck in the country before the viewer
  // could see it happen; then it fell straight down the radius, which put
  // it end-on to a camera looking straight at the same point and made it a
  // dot for the whole flight.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || size === 0 || !hit) return;
    const ms = dartFlightMs(reducedMotion);
    const altitude = hit.insideBorder ? HIT_ALTITUDE : POINT_HIT_ALTITUDE;
    globe.pointOfView({ lat: hit.lat, lng: hit.lng, altitude }, ms);
    setFlying(true);

    // The arc, computed once per throw rather than per frame. The landing
    // point comes from the globe's own getCoords so this and the library
    // agree about where a latitude is.
    const path = dartFlightPath(globe.getCoords(hit.lat, hit.lng, 0.01), altitude);
    const scale = dartThrowScale(altitude, DART_SCALE);

    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = (now - startedAt) / ms;
      const { visible, eased, spin, quiver } = dartFlightFrame(t);
      const dart = dartRef.current;
      if (dart) {
        dart.visible = visible;
        if (visible) {
          dart.scale.setScalar(scale);
          const point = dartPointAt(path, eased);
          const tangent = dartTangentAt(path, eased);
          dart.position.set(point.x, point.y, point.z);
          // Nose along the direction of TRAVEL, not at the globe's centre.
          // That is what lands it at an angle, like a dart in a board,
          // instead of standing it straight up out of the country.
          dart.lookAt(point.x + tangent.x, point.y + tangent.y, point.z + tangent.z);
          // About its own axis, which after lookAt is local +Z.
          dart.rotateZ(spin);
          // And the shudder on impact, about an axis across the dart, so
          // the tail swings rather than the whole thing rolling.
          if (quiver !== 0) dart.rotateX(quiver);
        }
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

  // The country the dart is in, lit up ON LANDING.
  //
  // This was the giveaway. The pin and the ring were already made to wait
  // for the dart, but the country itself lit up green on the first frame
  // of the throw - so the answer was on screen, in the largest possible
  // form, while the dart was still in the air. The whole throw was
  // watching a dart fall toward a country that had already announced
  // itself.
  //
  // Recomputed rather than stored so it cannot disagree with `hit`.
  const revealed = revealedHit(hit, flying);
  const hitCode = revealed?.code ?? null;

  // The stuck pin and the impact ring both wait for the landing. They used
  // to appear on the first frame of the throw, which told the viewer where
  // the dart had landed while it was still notionally in the air.
  const points = useMemo(
    () => (revealed ? [{ lat: revealed.lat, lng: revealed.lng }] : []),
    [revealed]
  );
  // One ring, expanding, as the impact. Re-created per throw so it replays.
  const rings = useMemo(
    () => (revealed ? [{ lat: revealed.lat, lng: revealed.lng, id: throwId }] : []),
    [revealed, throwId]
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
