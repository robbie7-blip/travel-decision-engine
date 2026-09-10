"use client";

import { useEffect, useState } from "react";

const MIN_VISIBLE_MS = 1650;
const FADE_MS = 300;

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
        // And keep the mark clear of the notch and the home indicator, so
        // "centred" is centred in the usable space rather than measured
        // through hardware.
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxSizing: "border-box",
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
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.svg" alt="" width={76} height={76} />
        <span className="font-display" style={{ fontSize: 48, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
          decide
        </span>
      </div>
    </div>
  );
}
