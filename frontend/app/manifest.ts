import type { MetadataRoute } from "next";

// Next.js App Router convention: this file's presence auto-generates
// /manifest.webmanifest and links it in <head> - no manual <link> tag needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "decide - Travel Decision Engine",
    short_name: "decide",
    description: "It doesn't list options. It decides for you.",
    start_url: "/",
    display: "standalone",
    // Must match --bg in globals.css. It didn't: this was the parchment
    // from two palettes ago, so an Android launch faded from one
    // off-white into a slightly different one.
    background_color: "#faf8f1",
    theme_color: "#2c6a4c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
