// Where a destination guide lives in each language. Bulgarian guides have
// their own path (/bg/destinations/...) rather than ?lang=bg on the English
// one, so search engines index them as pages of their own; the old ?lang=bg
// addresses redirect here. Client-safe: no filesystem, no server imports.

import type { Language } from "./types";

export function destinationsPath(language: Language, slug?: string): string {
  const base = language === "bg" ? "/bg/destinations" : "/destinations";
  return slug ? `${base}/${slug}` : base;
}

/** Canonical and hreflang for a guide (or the index, with no slug). The
 * English page is also the default for every other language. */
export function destinationAlternates(siteUrl: string, language: Language, slug?: string) {
  const site = siteUrl.replace(/\/$/, "");
  const en = `${site}${destinationsPath("en", slug)}`;
  const bg = `${site}${destinationsPath("bg", slug)}`;
  return {
    canonical: language === "bg" ? bg : en,
    languages: { en, bg, "x-default": en },
  };
}
