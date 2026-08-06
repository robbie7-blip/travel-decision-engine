"use client";

// The headline "Visualize" tab — a real 3D rotating globe, react-globe.gl
// (MIT; wraps three.js + globe.gl). Country shapes come from
// lib/worldGeo.ts, the SAME proven alpha-2-keyed topology the flat map
// already uses (see that file's header for why — a second, independently-
// sourced dataset here would risk exactly the kind of silent
// wrong-country-colored bug this app already hit once with the flat map's
// contrast issue).
//
// Colors are hardcoded hex (lib/theme.ts), not CSS var(--x) — this renders
// to a canvas/WebGL context, which can't resolve CSS custom properties at
// all.
//
// This must only ever be loaded via `next/dynamic(..., { ssr: false })` —
// three.js touches `document`/`window` at construction time, which throws
// during server-side rendering. See app/account/visited/page.tsx.
//
// Sizing follows the exact same pattern as VisitedMap.tsx's mobile-overflow
// fix: a ResizeObserver on our own wrapper, fed to the library as an
// explicit pixel width/height, rather than trusting the library's own
// auto-sizing (which, per that earlier bug, is not something to trust on
// real mobile browsers without verifying it here too).

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { WORLD_COUNTRY_FEATURES, type CountryFeature } from "@/lib/worldGeo";
import { CANVAS_COLORS } from "@/lib/theme";
import { getCountry } from "@/lib/countries";

export interface GlobePin {
  id: string;
  code: string;
  label: string;
  lat: number;
  lng: number;
  note?: string;
}

interface VisitedGlobeProps {
  visitedCodes: Set<string>;
  onToggleCountry?: (code: string) => void;
  visitedLabel: string;
  notVisitedLabel: string;
  untrackedLabel: string;
  pins?: GlobePin[];
  /** Pins mode: clicking the globe surface reports the coordinates back,
   * so the "add a pin" form can be prefilled instead of requiring someone
   * to type raw lat/lng from scratch. */
  onGlobeClick?: (coords: { lat: number; lng: number }) => void;
}

function isTracked(code: string): boolean {
  return getCountry(code) !== undefined;
}

export function VisitedGlobe({
  visitedCodes,
  onToggleCountry,
  visitedLabel,
  notVisitedLabel,
  untrackedLabel,
  pins,
  onGlobeClick,
}: VisitedGlobeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState(0);

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

  const globeMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: CANVAS_COLORS.bgPanel }), []);

  return (
    <div ref={wrapperRef} style={{ width: "100%", display: "flex", justifyContent: "center", overflow: "hidden" }}>
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
            const code = f.properties.I.toUpperCase();
            if (!isTracked(code)) return CANVAS_COLORS.bgPanelRaised;
            return visitedCodes.has(code) ? CANVAS_COLORS.accentGreen : CANVAS_COLORS.lineStrong;
          }}
          polygonSideColor={() => "rgba(138, 125, 104, 0.15)"}
          polygonStrokeColor={() => CANVAS_COLORS.inkDim}
          polygonAltitude={0.006}
          polygonLabel={(feat: object) => {
            const f = feat as CountryFeature;
            const code = f.properties.I.toUpperCase();
            if (!isTracked(code)) return `${f.properties.N} — ${untrackedLabel}`;
            return `${f.properties.N} — ${visitedCodes.has(code) ? visitedLabel : notVisitedLabel}`;
          }}
          onPolygonClick={(feat: object) => {
            const f = feat as CountryFeature;
            const code = f.properties.I.toUpperCase();
            if (!isTracked(code) || !onToggleCountry) return;
            onToggleCountry(code);
          }}
          onGlobeClick={onGlobeClick}
          pointsData={pins ?? []}
          pointLat={(p: object) => (p as GlobePin).lat}
          pointLng={(p: object) => (p as GlobePin).lng}
          pointColor={() => CANVAS_COLORS.accent1}
          pointAltitude={0.03}
          pointRadius={0.55}
          pointLabel={(p: object) => {
            const pin = p as GlobePin;
            return pin.note ? `${pin.label} — ${pin.note}` : pin.label;
          }}
          onGlobeReady={() => {
            const controls = globeRef.current?.controls();
            if (controls) {
              controls.autoRotate = true;
              controls.autoRotateSpeed = 0.5;
            }
            globeRef.current?.pointOfView({ lat: 20, lng: 10, altitude: 2.2 });
          }}
        />
      )}
    </div>
  );
}
