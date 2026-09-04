"use client";

// Spin the wheel and see where you can go.
//
// The one rule this component has to keep: the wheel lands where it says it
// lands. The result is drawn first and the final rotation is then computed
// to put that exact slice under the pointer, so what stops beneath the
// marker is the answer, not a decoration playing over a decision made
// elsewhere. For a product whose entire argument is that it does not
// pretend, a rigged wheel would be a strange place to start.
//
// Every city on it is one with a real guide and a real photograph (see
// lib/spin.ts), so a spin opens onto something rather than just naming a
// place.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { drawWheel, spinCityName, INITIAL_WHEEL, WHEEL_SLICES, type SpinSlug } from "@/lib/spin";
import { DESTINATION_PHOTO_CREDITS } from "@/lib/destinationPhotoCredits";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

const SIZE = 400;
const CENTRE = SIZE / 2;
const RADIUS = 186;
const SLICE_DEG = 360 / WHEEL_SLICES;

/** Long enough to feel like a spin, short enough not to become a wait. */
const SPIN_MS = 4200;
/** Full turns before it settles, so the deceleration reads as physics. */
const SPIN_TURNS = 5;

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTRE + r * Math.cos(rad), y: CENTRE + r * Math.sin(rad) };
}

function slicePath(index: number): string {
  const start = index * SLICE_DEG;
  const end = start + SLICE_DEG;
  const a = polar(start, RADIUS);
  const b = polar(end, RADIUS);
  // large-arc is always 0: twelve slices are 30 degrees each.
  return `M ${CENTRE} ${CENTRE} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`;
}

/** Alternating fills from the existing palette rather than twelve new
 * hues. Both carry white type well above AA, which is the constraint that
 * decides them: the label sits on the fill. */
const FILLS = ["var(--brand-teal)", "var(--deep)"];

export function SpinWheel({ t, language }: { t: Dictionary; language: Language }) {
  const [wheel, setWheel] = useState<SpinSlug[]>(INITIAL_WHEEL);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinSlug | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reshuffled after mount, not during render, so the server and the first
  // client render agree and nobody sees the wheel rebuild itself.
  useEffect(() => {
    setWheel(drawWheel());
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function spin() {
    if (spinning) return;
    const index = Math.floor(Math.random() * wheel.length);
    const landed = wheel[index];

    // Where that slice's centre has to end up: directly under the pointer
    // at twelve o'clock. Added to the current rotation rather than set
    // absolutely, so consecutive spins keep turning forwards instead of
    // snapping backwards to a smaller angle.
    const centreOfSlice = index * SLICE_DEG + SLICE_DEG / 2;
    const settled = 360 - centreOfSlice;
    const current = ((rotation % 360) + 360) % 360;
    const delta = ((settled - current) % 360 + 360) % 360;

    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    setResult(null);
    if (reduced) {
      // No spin, but still an honest one: the wheel is set to the same
      // final angle, so the marker points at the named city.
      setRotation(rotation + delta);
      setResult(landed);
      return;
    }

    setSpinning(true);
    setRotation(rotation + SPIN_TURNS * 360 + delta);
    timer.current = setTimeout(() => {
      setSpinning(false);
      setResult(landed);
    }, SPIN_MS);
  }

  function reshuffle() {
    if (spinning) return;
    setResult(null);
    setWheel(drawWheel());
  }

  const suffix = language === "bg" ? "?lang=bg" : "";
  const credit = result ? DESTINATION_PHOTO_CREDITS[result] : undefined;

  return (
    <div className="spin">
      <div className="spin-stage">
        <div className="spin-pointer" aria-hidden />
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="spin-wheel"
          style={{
            transform: `rotate(${rotation}deg)`,
            transitionDuration: spinning ? `${SPIN_MS}ms` : "0ms",
          }}
          aria-hidden
        >
          {wheel.map((slug, i) => {
            const labelAngle = i * SLICE_DEG + SLICE_DEG / 2;
            const labelY = CENTRE - RADIUS + 34;
            // Radial, with no per-slice flipping, and that is deliberate.
            // The landing always brings the winning slice to exactly twelve
            // o'clock, which means its label's total rotation comes to a
            // whole number of turns: the city you actually won is always
            // perfectly upright under the pointer, every time. Flipping the
            // lower half made the at-rest wheel tidier and broke precisely
            // that, leaving half the winners upside down at the moment they
            // matter most.
            const transform = `rotate(${labelAngle} ${CENTRE} ${CENTRE})`;
            return (
              <g key={slug}>
                <path d={slicePath(i)} fill={FILLS[i % FILLS.length]} stroke="var(--bg)" strokeWidth="1.5" />
                <text
                  className="spin-label"
                  x={CENTRE}
                  y={labelY}
                  textAnchor="middle"
                  transform={transform}
                  fill="#fffdf8"
                >
                  {spinCityName(slug, language)}
                </text>
              </g>
            );
          })}
          <circle cx={CENTRE} cy={CENTRE} r="30" fill="var(--bg-panel)" stroke="var(--line-strong)" strokeWidth="2" />
        </svg>
      </div>

      <div className="spin-controls">
        <button type="button" onClick={spin} disabled={spinning} className="font-ui btn-primary spin-button">
          {spinning ? t.spin.spinning : result ? t.spin.again : t.spin.spin}
        </button>
        <button type="button" onClick={reshuffle} disabled={spinning} className="font-ui spin-reshuffle">
          {t.spin.reshuffle}
        </button>
      </div>

      {/* Announced, not just shown: the result arrives after an animation,
          which a screen reader would otherwise have no way to notice. */}
      <div className="spin-result" role="status" aria-live="polite">
        {result && (
          <div className="spin-result-card">
            <div className="spin-result-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/destinations/${result}.jpg`} alt="" />
              {credit && (
                <a
                  className="spin-result-credit font-ui"
                  href={credit.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer license"
                >
                  {credit.artist} · {credit.license}
                </a>
              )}
            </div>
            <div className="spin-result-body">
              <div className="font-ui spin-result-eyebrow">{t.spin.youreGoing}</div>
              <div className="font-display spin-result-city">{spinCityName(result, language)}</div>
              <div className="spin-result-actions">
                <Link href={`/?dest=${encodeURIComponent(spinCityName(result, "en"))}`} className="font-ui btn-primary spin-plan">
                  {t.spin.planIt}
                </Link>
                <Link href={`/destinations/${result}${suffix}`} className="font-ui spin-guide">
                  {t.spin.readGuide}
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
