"use client";

// A real place beside the headline.
//
// The homepage of a travel product had no picture of anywhere on it. This
// puts one there, using the destination-guide photos already in the repo,
// so it costs nothing and every image is a city the product genuinely has
// a guide for - the picture is a claim, and it is a true one. Each frame
// links to that city's guide, so the most decorative element on the page
// is also a real way in.
//
// Beside the headline rather than behind it, deliberately. A full-bleed
// photo under the hero text would put white type over an arbitrary
// photograph, and the contrast of every line in that band is currently
// guaranteed by scripts/checkContrast.mjs against a known colour. Keeping
// the type on the green keeps that guarantee exact instead of trading it
// for a scrim and a hope.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DESTINATION_CITY_NAMES_BG } from "@/lib/destinationCityNamesBg";
import { DESTINATION_PHOTO_CREDITS } from "@/lib/destinationPhotoCredits";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** Hand-ordered, not the whole set of 24: these are the frames worth
 * leading with, and the first one is the page's largest image so it is
 * chosen to look right rather than to come first alphabetically. */
const FRAMES = ["rome", "tokyo", "lisbon", "prague", "copenhagen", "barcelona"] as const;

const ROTATE_MS = 6000;
const FADE_MS = 900;

export function HeroGallery({ t, language }: { t: Dictionary; language: Language }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const preloaded = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Motion that starts on its own is exactly what a reduced-motion
    // preference is about, so this holds on the first frame instead. The
    // photo is still there; it just does not move.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || paused) return;

    const timer = setInterval(() => setIndex((i) => (i + 1) % FRAMES.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  // Decode the next frame before it is needed, so the crossfade does not
  // land on a blank box on a slow connection.
  useEffect(() => {
    const next = FRAMES[(index + 1) % FRAMES.length];
    if (preloaded.current.has(next)) return;
    preloaded.current.add(next);
    const img = new Image();
    img.src = `/destinations/${next}.jpg`;
  }, [index]);

  const slug = FRAMES[index];
  const suffix = language === "bg" ? "?lang=bg" : "";
  // These are Wikimedia photographs and most of their licences require the
  // photographer, the licence and a link back. Rendered wherever the photo
  // is, not only on the guide page it came from.
  const credit = DESTINATION_PHOTO_CREDITS[slug];

  return (
    <div
      className="hero-gallery"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Pausing on focus as well as hover: a keyboard user tabbing to the
      // link should not have it change out from under them.
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Link href={`/destinations/${slug}${suffix}`} className="hero-gallery-link">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={slug}
          src={`/destinations/${slug}.jpg`}
          alt=""
          className="hero-gallery-img"
          style={{ animationDuration: `${FADE_MS}ms` }}
          // The first frame is the page's largest image and the likely LCP
          // element, so it is fetched eagerly and at priority; the rest
          // arrive through the preloader above.
          fetchPriority={index === 0 ? "high" : "auto"}
          decoding="async"
        />
        <span className="hero-gallery-caption font-ui">
          <span className="hero-gallery-city">{cityName(slug, language)}</span>
          <span className="hero-gallery-cue">{t.destinations.eyebrow}</span>
        </span>
      </Link>

      {credit && (
        <a
          className="hero-gallery-credit font-ui"
          href={credit.sourceUrl}
          target="_blank"
          rel="noopener noreferrer license"
        >
          {credit.artist} · {credit.license}
        </a>
      )}

      {/* Which frame you are on, and a way to pick one. Small, because it
          is a nicety rather than navigation. */}
      <div className="hero-gallery-dots" role="tablist" aria-label={t.destinations.eyebrow}>
        {FRAMES.map((frame, i) => (
          <button
            key={frame}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={capitalize(frame)}
            onClick={() => setIndex(i)}
            className="hero-gallery-dot"
            data-active={i === index}
          />
        ))}
      </div>
    </div>
  );
}

function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** The guides' own Bulgarian city names, so the caption matches the page
 * the frame links to rather than showing a Latin name inside a Cyrillic
 * layout. Same map lib/destinations.ts uses server-side. */
function cityName(slug: string, language: Language): string {
  if (language === "bg" && DESTINATION_CITY_NAMES_BG[slug]) return DESTINATION_CITY_NAMES_BG[slug];
  return capitalize(slug);
}
