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
//
// TWO THINGS THIS GOT WRONG, both found by driving it in a phone-sized
// browser rather than by reading it.
//
// It did not animate at all for anyone with "Reduce Motion" on - which on
// iOS is one toggle in Accessibility and very commonly enabled. The
// rotation was a CSS transition, and globals.css carries a blanket
// `@media (prefers-reduced-motion: reduce) { * { transition: none
// !important } }`. So the wheel teleported: one frame upright, the next at
// its final angle, result already on screen. Measured, not guessed - five
// consecutive samples of the computed transform during a "spin" were
// byte-identical.
//
// The fix is not to ignore the preference. It is to honour what the
// preference actually asks for - LESS motion, not none - so a reduced
// spin travels the last 140 degrees in 900ms instead of whirling five
// times round in 4.2 seconds. Driven with the Web Animations API rather
// than a CSS transition, which also means the duration is chosen per spin
// instead of fought over with a global !important, and the wheel is a
// plain <div> rather than the <svg> root, because CSS transforms on an SVG
// root element are the shakiest ground in this whole layout.
//
// And "New cities" mostly showed the same cities. It drew 12 from a pool of
// 24 independently each time, so a fresh wheel shared six with the old one
// on average. drawWheel now takes the current wheel as `avoid`, and since
// the pool is exactly twice the wheel that means every city changes - see
// lib/spin.ts. A repeat spin redraws too, because spinning again is the
// other moment somebody is asking for something they have not seen.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { drawWheel, spinCityName, INITIAL_WHEEL, WHEEL_SLICES, type SpinSlug } from "@/lib/spin";
import { DESTINATION_PHOTO_CREDITS } from "@/lib/destinationPhotoCredits";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { safeHref } from "@/lib/linkify";

const SIZE = 400;
const CENTRE = SIZE / 2;
const RADIUS = 186;
const SLICE_DEG = 360 / WHEEL_SLICES;

/** Long enough to feel like a spin, short enough not to become a wait. */
const SPIN_MS = 4200;
/** Full turns before it settles, so the deceleration reads as physics. */
const SPIN_TURNS = 5;

/** The reduced-motion spin: the final approach only, and briefly.
 *
 * Not zero. `prefers-reduced-motion` asks for less movement, not for a
 * control that appears broken - and a wheel that jumps to its answer with
 * no travel at all reads as broken, which is exactly how this was
 * reported. 140 degrees over 900ms is a settle rather than a spin: no
 * repeated rotation, nothing crossing the field of view more than once.
 *
 * The landing is identical either way. Both paths finish at the same angle
 * with the same city under the pointer, so the honesty property this
 * component is built around is untouched. */
const REDUCED_SPIN_MS = 900;
const REDUCED_SPIN_DEG = 140;

/** The long tail that makes a spin feel like one: fast, then a slow settle.
 * Was in globals.css as a transition-timing-function; it moves here with
 * the animation it belongs to. */
const SPIN_EASING = "cubic-bezier(0.15, 0.85, 0.15, 1)";
const REDUCED_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

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
  // The element the rotation is applied to. A <div>, not the <svg>: CSS
  // transforms on an SVG root element are the least reliably implemented
  // corner of this layout, and there is no reason to stand on it.
  const rotor = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);

  // Reshuffled after mount, not during render, so the server and the first
  // client render agree and nobody sees the wheel rebuild itself.
  useEffect(() => {
    setWheel(drawWheel());
    return () => {
      if (timer.current) clearTimeout(timer.current);
      animation.current?.cancel();
    };
  }, []);

  function spin() {
    if (spinning) return;

    // Spinning again is somebody asking for something they have not seen,
    // so the wheel is redrawn first - away from the twelve currently on it
    // (see drawWheel's `avoid`). The first spin keeps the wheel the visitor
    // has been looking at; only a REPEAT redraws, which is what `result`
    // marks.
    //
    // Redrawn before the landing is chosen, never after, so this cannot
    // become a way of quietly picking the answer: the index below is drawn
    // from whatever wheel is about to turn.
    const turning = result ? drawWheel(Math.random, wheel) : wheel;
    if (turning !== wheel) setWheel(turning);

    const index = Math.floor(Math.random() * turning.length);
    const landed = turning[index];

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

    // Same destination on both paths. What differs is only how far the
    // wheel travels to get there: five turns plus the delta, or a short
    // approach that starts a fixed distance back from it.
    const to = rotation + (reduced ? 0 : SPIN_TURNS * 360) + delta;
    const from = reduced ? to - REDUCED_SPIN_DEG : rotation;
    const duration = reduced ? REDUCED_SPIN_MS : SPIN_MS;

    setResult(null);
    setRotation(to);

    const el = rotor.current;
    // No Web Animations API means no animation - the wheel simply ends up
    // at the right angle, which is what every path did before this.
    if (!el || typeof el.animate !== "function") {
      setResult(landed);
      return;
    }

    setSpinning(true);
    animation.current?.cancel();
    // Driven here rather than by a CSS transition, which globals.css
    // disables outright under prefers-reduced-motion with `* { transition:
    // none !important }` - the rule that made a reduced-motion "spin" a
    // teleport. A script-driven animation is also the only way to pick the
    // duration per spin.
    const anim = el.animate(
      [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
      { duration, easing: reduced ? REDUCED_EASING : SPIN_EASING, fill: "both" }
    );
    animation.current = anim;
    anim.addEventListener("finish", () => {
      // The element's own style already holds `to` by now (React committed
      // it above), so dropping the animation cannot flash: both agree on
      // the same angle.
      anim.cancel();
      if (animation.current === anim) animation.current = null;
      setSpinning(false);
      setResult(landed);
    });
    // A belt-and-braces settle in case "finish" never arrives - a
    // backgrounded tab can pause an animation indefinitely, and a wheel
    // stuck on "Spinning…" with a disabled button is unrecoverable without
    // a reload.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (anim.playState !== "finished") {
        anim.cancel();
        setSpinning(false);
        setResult(landed);
      }
    }, duration + 1200);
  }

  function reshuffle() {
    if (spinning) return;
    setResult(null);
    // Away from what is on the wheel now, so "New cities" means new cities
    // rather than a reshuffle that keeps half of them.
    setWheel(drawWheel(Math.random, wheel));
  }

  const suffix = language === "bg" ? "?lang=bg" : "";
  const credit = result ? DESTINATION_PHOTO_CREDITS[result] : undefined;

  return (
    <div className="spin">
      <div className="spin-stage">
        <div className="spin-pointer" aria-hidden />
        <div ref={rotor} className="spin-rotor" style={{ transform: `rotate(${rotation}deg)` }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="spin-wheel" aria-hidden>
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
                  href={safeHref(credit.sourceUrl) ?? undefined}
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
