"use client";

// The two pages nobody designs until someone lands on one: 404, and the
// error boundary.
//
// WHY THIS EXISTED AS NOTHING. The app had no app/not-found.tsx and no
// app/error.tsx, so a mistyped URL got Next's default - white background,
// system font, "This page could not be found" in 14px Helvetica next to a
// thin dividing rule. On a site where every other surface is parchment,
// Literata and a green rule, that page was the only one with none of the
// brand on it, and it is the page you see precisely when something has
// already gone wrong.
//
// ONE COMPONENT, TWO USES. A 404 and a crash want the same furniture - the
// header, the illustration, a heading, a line of explanation, a way out -
// and differ only in words and in whether there is anything to retry. Two
// files that are 90% the same is how one of them ends up with the old
// padding.
//
// WHY IT IS A CLIENT COMPONENT. not-found.tsx is rendered for routes that
// did not match, so it is handed no searchParams and cannot read ?lang=bg
// the way every other page does. The language lives in localStorage
// (LANGUAGE_STORAGE_KEY), so reading it here is the only way a Bulgarian
// visitor gets Bulgarian on the one page that is already apologising. Same
// arrangement CompareStatsView uses.

import { useEffect, useState } from "react";
import Link from "next/link";
// No SiteFooter here: app/layout.tsx renders one for every page, and
// adding a second put two identical copyright lines at the bottom of the
// 404. Caught by screenshotting the page rather than by any check.
import { SiteHeader } from "./SiteHeader";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { destinationsPath } from "@/lib/destinationPaths";

/** The illustration, as a file rather than inline.
 *
 * It is 10KB of path data; inlining it would put that into the HTML of
 * two pages and into every bundle that imports them, to save one request
 * that is cached forever. */
const ILLUSTRATION = "/illustrations/off-the-map.svg";

export function DeadEndView({ kind, onRetry }: { kind: "not-found" | "error"; onRetry?: () => void }) {
  // Starts at English and corrects itself after mount. Rendering nothing
  // until the language is known would mean a blank page on the one route
  // that is already a dead end.
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === "bg") setLanguage("bg");
    } catch {
      /* private mode, blocked storage - English is a fine answer */
    }
  }, []);

  const t = TRANSLATIONS[language];
  const copy = kind === "error" ? t.errorPage : t.notFound;
  const suffix = language === "bg" ? "?lang=bg" : "";

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {/* No contextLink: SiteHeader's nav row already carries "Plan a
          trip" as its first item, and passing one put the same words
          twice in the same header. */}
      <SiteHeader language={language} onLanguageChange={setLanguage} t={t} />

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "56px clamp(24px, 8%, 180px) 72px",
        }}
      >
        <div className="dead-end">
          {/* Decorative: the heading beside it says the same thing in
              words, so a screen reader announcing "map with a dart in
              it" would only repeat it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ILLUSTRATION} alt="" className="dead-end-art" width={420} height={363} />

          <div className="dead-end-body">
            <h1 className="font-display dead-end-heading">{copy.heading}</h1>
            <p className="dead-end-text">{copy.body}</p>

            <div className="dead-end-actions">
              {kind === "error" && onRetry ? (
                <>
                  <button type="button" onClick={onRetry} className="font-ui btn-primary">
                    {t.errorPage.retry}
                  </button>
                  <Link href={`/${suffix}`} className="font-ui dead-end-link">
                    {t.errorPage.planTrip}
                  </Link>
                </>
              ) : (
                <>
                  <Link href={`/${suffix}`} className="font-ui btn-primary">
                    {t.notFound.planTrip}
                  </Link>
                  <Link href={destinationsPath(language)} className="font-ui dead-end-link">
                    {t.notFound.guides}
                  </Link>
                  <Link href={`/decide-for-me${suffix}`} className="font-ui dead-end-link">
                    {t.notFound.decideForMe}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
