"use client";

// "Throw a dart at the globe" - the whole feature, minus the WebGL canvas
// it loads.
//
// WHAT IT ANSWERS. The same traveller the wheel was built for: the one who
// wants to go somewhere and has no idea where, for whom the trip form's
// first field is a dead end. The difference is reach. The wheel could only
// land on the 24 cities with a curated guide; the dart can land on any of
// the 168 countries the topology has a border for, because the trip form
// takes free text and a guide was never what made a result plannable (see
// lib/dartGlobe.ts).
//
// IT STICKS WHERE IT SAYS IT STICKS. The country is drawn first and the
// landing point is sampled INSIDE that country's own polygon, then the
// camera flies there - so the marker is in the border that gets named. Same
// property the wheel's design note is built around, asserted the same way,
// and for the same reason: for a product whose whole argument is that it
// does not pretend, a rigged dart would be a strange place to start.
//
// THE WHEEL IS STILL HERE, as the fallback, and not only for taste. WebGL
// genuinely fails - an old phone, a blocklisted driver, a browser with it
// switched off - and without a fallback those visitors get an empty box
// where a feature should be. So the canvas is only reached once WebGL has
// actually been confirmed, and the wheel answers the same question for
// everyone else.

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SpinWheel } from "./SpinWheel";
import { guidesForCountry, throwDart, type DartHit } from "@/lib/dartGlobe";
import { getCountryName } from "@/lib/countries";
import { spinCityName } from "@/lib/spin";
import { DESTINATION_PHOTO_CREDITS } from "@/lib/destinationPhotoCredits";
import { safeHref } from "@/lib/linkify";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

// ssr: false is not optional - three.js touches document at construction
// time and throws during server rendering. Same rule the visited globe
// documents on itself.
const DartGlobeCanvas = dynamic(() => import("./DartGlobeCanvas"), { ssr: false });

/** Whether this browser can actually draw the globe.
 *
 * Asked by trying, not by sniffing a user agent. A context that fails to
 * create is the honest signal, and it covers the cases a feature-detect on
 * `window.WebGLRenderingContext` misses: WebGL disabled in settings, a
 * blocklisted driver, a headless environment. Null while the question is
 * still being asked, so nothing renders the fallback for one frame and then
 * swaps it.
 */
function useWebglSupport(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      setSupported(gl !== null);
    } catch {
      setSupported(false);
    }
  }, []);
  return supported;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function GlobeDart({ t, language }: { t: Dictionary; language: Language }) {
  const webgl = useWebglSupport();
  const reducedMotion = usePrefersReducedMotion();

  // Which way the traveller wants to be told. The globe leads when the
  // browser can draw it, and the wheel stays one tap away rather than
  // deleted - it answers the same question, it weighs nothing, and some
  // people simply prefer it.
  const [mode, setMode] = useState<"globe" | "wheel">("globe");

  const [hit, setHit] = useState<DartHit | null>(null);
  const [throwId, setThrowId] = useState(0);
  const [inFlight, setInFlight] = useState(false);
  // Held back until the camera arrives, so the answer appears with the dart
  // rather than before the globe has finished moving.
  const [landed, setLanded] = useState<DartHit | null>(null);
  const backstop = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (backstop.current) clearTimeout(backstop.current);
  }, []);

  function throwIt() {
    if (inFlight) return;
    const next = throwDart();
    if (!next) return;
    setLanded(null);
    setHit(next);
    setThrowId((n) => n + 1);
    setInFlight(true);

    // A backstop, because onArrived comes from the canvas and the canvas
    // can fail to arrive. It did: the first version never rendered at all
    // (a collapsed grid track - see the note in DartGlobeCanvas), and the
    // only symptom was this button disabled forever with no error anywhere.
    // A dead control that needs a page reload is a worse outcome than a
    // result that appears without its camera move, so the result wins.
    if (backstop.current) clearTimeout(backstop.current);
    backstop.current = setTimeout(() => {
      setInFlight(false);
      setLanded(next);
    }, 4000);
  }

  const guides = useMemo(() => (landed ? guidesForCountry(landed.code) : []), [landed]);
  const countryName = landed ? getCountryName(landed.code, language) : "";
  const suffix = language === "bg" ? "?lang=bg" : "";

  // Still deciding whether the globe can be drawn. Nothing, rather than a
  // flash of the wheel that is then replaced.
  if (webgl === null) {
    return <div className="spin" style={{ minHeight: 360 }} aria-hidden />;
  }

  // No WebGL: the wheel, with the reason said out loud rather than a
  // silently different page.
  if (!webgl) {
    return (
      <div>
        <p className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 16 }}>
          {t.spin.globeUnavailable}
        </p>
        <SpinWheel t={t} language={language} />
        <p className="font-ui spin-note">{t.spin.note}</p>
      </div>
    );
  }

  if (mode === "wheel") {
    return (
      <div>
        <SpinWheel t={t} language={language} />
        <button type="button" onClick={() => setMode("globe")} className="font-ui spin-switch">
          {t.spin.globeInstead}
        </button>
        <p className="font-ui spin-note">{t.spin.note}</p>
      </div>
    );
  }

  return (
    <div className="spin">
      <div className="spin-stage">
        <DartGlobeCanvas
          hit={hit}
          throwId={throwId}
          reducedMotion={reducedMotion}
          onArrived={() => {
            if (backstop.current) clearTimeout(backstop.current);
            setInFlight(false);
            setLanded(hit);
          }}
        />
      </div>

      <div className="spin-controls">
        <button type="button" onClick={throwIt} disabled={inFlight} className="font-ui btn-primary spin-button">
          {inFlight ? t.spin.throwing : landed ? t.spin.throwAgain : t.spin.throwDart}
        </button>
        <button type="button" onClick={() => setMode("wheel")} disabled={inFlight} className="font-ui spin-reshuffle">
          {t.spin.wheelInstead}
        </button>
      </div>

      {/* Announced, not just shown - the result arrives after an animation,
          which a screen reader would otherwise have no way to notice. */}
      <div className="spin-result" role="status" aria-live="polite">
        {landed && (
          <div className="spin-result-card">
            {/* The photograph only exists for a city with a guide, so a
                country without one gets the body alone rather than a broken
                image. */}
            {guides.length > 0 && (
              <div className="spin-result-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/destinations/${guides[0]}.jpg`} alt="" />
                {DESTINATION_PHOTO_CREDITS[guides[0]] && (
                  <a
                    className="spin-result-credit font-ui"
                    href={safeHref(DESTINATION_PHOTO_CREDITS[guides[0]].sourceUrl) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer license"
                  >
                    {DESTINATION_PHOTO_CREDITS[guides[0]].artist} · {DESTINATION_PHOTO_CREDITS[guides[0]].license}
                  </a>
                )}
              </div>
            )}
            <div className="spin-result-body">
              <div className="font-ui spin-result-eyebrow">{t.spin.landedIn}</div>
              <div className="font-display spin-result-city">{countryName}</div>

              {guides.length > 0 ? (
                <>
                  <div className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "2px 0 10px" }}>
                    {t.spin.guidesHere}
                  </div>
                  <div className="spin-result-actions" style={{ flexWrap: "wrap" }}>
                    {guides.map((slug) => (
                      <Link
                        key={slug}
                        href={`/?dest=${encodeURIComponent(spinCityName(slug, "en"))}`}
                        className="font-ui btn-primary spin-plan"
                      >
                        {spinCityName(slug, language)}
                      </Link>
                    ))}
                    <Link href={`/destinations/${guides[0]}${suffix}`} className="font-ui spin-guide">
                      {t.spin.readGuide}
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  {/* Said plainly rather than hidden: we have no guide for
                      this one, and the planner still plans it. The form
                      takes free text, which is the whole reason the dart
                      can reach the world in the first place. */}
                  <div className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "2px 0 10px" }}>
                    {t.spin.noGuideYet}
                  </div>
                  <div className="spin-result-actions">
                    <Link
                      href={`/?dest=${encodeURIComponent(getCountryName(landed.code, "en"))}`}
                      className="font-ui btn-primary spin-plan"
                    >
                      {t.spin.planHere}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Says how it works, because "it sticks where it lands" is a claim
          and this product does not make claims it hides. */}
      <p className="font-ui spin-note">{t.spin.dartNote}</p>
    </div>
  );
}
