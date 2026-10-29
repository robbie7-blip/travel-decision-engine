"use client";

import { useEffect, useState } from "react";

const MIN_VISIBLE_MS = 1650;
const FADE_MS = 300;

/** The logo mark, drawn in the page rather than fetched as
 * /logo-icon.svg: as a separate file it arrived on its own schedule, and
 * on a phone the mark and the word appeared a beat apart. Same drawing as
 * that file; the ids are prefixed so they cannot clash with the page's. */
function SplashMark() {
  return (
    <svg width={76} height={76} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <radialGradient id="splashDotGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#d9643f" stopOpacity="0.4" />
          <stop offset="70%" stopColor="#d9643f" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#d9643f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="splashLeft" x1="18" y1="15" x2="50" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e8a23f" />
          <stop offset="1" stopColor="#8a7d68" />
        </linearGradient>
        <linearGradient id="splashRight" x1="82" y1="15" x2="50" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e8a23f" />
          <stop offset="1" stopColor="#8a7d68" />
        </linearGradient>
        <linearGradient id="splashMid" x1="50" y1="10" x2="50" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f9a72" />
          <stop offset="1" stopColor="#2c6a4c" />
        </linearGradient>
      </defs>
      <path d="M18 15 Q 34 40 50 72" fill="none" stroke="url(#splashLeft)" strokeWidth="3.5" strokeLinecap="round" opacity="0.65" />
      <path d="M82 15 Q 66 40 50 72" fill="none" stroke="url(#splashRight)" strokeWidth="3.5" strokeLinecap="round" opacity="0.65" />
      <path d="M50 10 L 50 72" fill="none" stroke="url(#splashMid)" strokeWidth="4.5" strokeLinecap="round" opacity="0.85" />
      <circle cx="50" cy="78" r="13" fill="url(#splashDotGlow)" />
      <circle cx="50" cy="78" r="8" fill="#d9643f" />
    </svg>
  );
}

/** Brief branded overlay shown once when the app is first opened in a
 * browser tab - mounts in the root layout, so client-side navigations
 * within the app never re-trigger it. Purely cosmetic: fades itself out
 * on a timer rather than waiting on any real loading signal. */
export function AppSplash() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), MIN_VISIBLE_MS);
    const removeTimer = setTimeout(() => setVisible(false), MIN_VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        // Centred in the area the traveler can actually SEE, not in the
        // layout viewport.
        //
        // "inset: 0" alone resolves against the layout viewport, which on
        // iOS Safari is not the visible region: the browser's chrome
        // overlays it, so the box's middle and the visible middle are
        // different places and the logo sat noticeably high on a real
        // phone. It measures dead-centre in a desktop browser at a fixed
        // viewport, which is why this needed a device to notice.
        //
        // 100dvh is the dynamic viewport height - it tracks the visible
        // area as the toolbars collapse and expand, so the centre stays
        // the centre. Height wins over the "bottom" half of inset for a
        // fixed element, so the two do not fight; inset stays for the
        // left/right edges and as the fallback anywhere dvh is unknown.
        height: "100dvh",
        // No safe-area padding here on purpose. env(safe-area-inset-*)
        // resolves to 0 unless the viewport opts in with
        // viewport-fit=cover, which this app deliberately does not - so
        // padding for the notch would be two declarations that compute to
        // nothing and a comment claiming otherwise. Without cover, the
        // layout viewport already excludes the unsafe areas.
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "var(--bg)",
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      {/* .splash-lockup (globals.css) fades the mark and the word in
          together a moment after first paint. CSS, not a state change:
          the page's script can arrive well after the font on a slow
          phone, and waiting for it left the splash blank. The headline
          font is preloaded, so the delay is usually enough for it. */}
      <div className="splash-lockup" style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <SplashMark />
        <span className="font-display" style={{ fontSize: 48, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
          decide
        </span>
      </div>
    </div>
  );
}
