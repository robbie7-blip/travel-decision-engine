"use client";

// Not drawing what nobody can see. A react-globe.gl globe renders every
// frame for as long as it exists - it is a WebGL loop, not a picture - so
// scrolled off screen, or in a background tab, it was still spending a
// phone's battery on an idle turn. Paused while hidden, resumed when back.
// Used by DartGlobeCanvas and VisitedGlobe.

import { useEffect, type RefObject } from "react";
import type { GlobeMethods } from "react-globe.gl";

export function usePauseWhenHidden(
  wrapperRef: RefObject<HTMLElement | null>,
  globeRef: RefObject<GlobeMethods | undefined>,
  size: number
): void {
  useEffect(() => {
    const el = wrapperRef.current;
    const globe = globeRef.current;
    if (!el || !globe || size === 0 || typeof IntersectionObserver === "undefined") return;
    let onScreen = true;
    const apply = () => {
      if (onScreen && document.visibilityState === "visible") globe.resumeAnimation();
      else globe.pauseAnimation();
    };
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      apply();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
      globe.resumeAnimation();
    };
  }, [wrapperRef, globeRef, size]);
}
