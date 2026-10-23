// Where the blog lives in each language, and cover photos at a given size.
// Client-safe: no server imports.

import type { Language } from "./types";

export function blogPath(language: Language, slug?: string): string {
  const base = language === "bg" ? "/bg/blog" : "/blog";
  return slug ? `${base}/${slug}` : base;
}

/** A cover at about `width` pixels wide (and `height` tall, cropped, when
 * given). Pexels and Unsplash both size images from the address; the
 * site's own /destinations photos are served as they are. */
export function sizedCover(url: string, width: number, height?: number): string {
  try {
    const u = new URL(url);
    if (u.hostname === "images.pexels.com") {
      u.searchParams.set("auto", "compress");
      u.searchParams.set("cs", "tinysrgb");
      u.searchParams.set("w", String(width));
      if (height) {
        u.searchParams.set("h", String(height));
        u.searchParams.set("fit", "crop");
      }
      return u.toString();
    }
    if (u.hostname === "images.unsplash.com") {
      u.searchParams.set("auto", "format");
      u.searchParams.set("q", "75");
      u.searchParams.set("w", String(width));
      if (height) {
        u.searchParams.set("h", String(height));
        u.searchParams.set("fit", "crop");
      }
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}
