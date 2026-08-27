import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, DM_Mono, Roboto_Mono } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { AppSplash } from "@/components/AppSplash";
import { SiteFooter } from "@/components/SiteFooter";
import { getSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

// The UI font: nav, chips, labels, prices, everything that isn't a
// heading. DM Mono ships 300/400/500 and nothing heavier — the 600 and
// 700 weights scattered through the components have no real face to land
// on, so globals.css turns synthetic bolding off for .font-mono and lets
// them settle on 500 rather than render as a smeared fake bold.
const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["300", "400", "500"],
});

// Cyrillic only, and only ever downloaded when a Cyrillic glyph is
// actually on the page — the @font-face rules next/font emits are
// unicode-range gated, so an English visitor pays nothing for this.
//
// It exists because DM Mono has no Cyrillic at all: latin and latin-ext
// and that's it. The Bulgarian site is a real, shipped locale, and
// without a companion face every mono label on it — the nav, the
// confidence chips, the prices — would silently drop to Arial while the
// same elements on the English site sat in DM Mono. Roboto Mono's
// Cyrillic is close enough in width and colour to sit beside DM Mono
// without reading as a different design.
const cyrillicMono = Roboto_Mono({
  subsets: ["cyrillic"],
  variable: "--font-mono-cyrillic",
  weight: ["400", "500"],
  // Not preloaded: a preload link fires on every page whether or not the
  // page has a single Cyrillic character on it, which would make the
  // English site pay for the Bulgarian one. Without it the file is
  // fetched when the stylesheet says a glyph needs it, which is exactly
  // the pages that do.
  preload: false,
});

const siteUrl = getSiteUrl();

const title = "decide — Travel decision engine";
const description = "It doesn't list options. It decides.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  appleWebApp: {
    capable: true,
    title: "decide",
    statusBarStyle: "default",
  },
  openGraph: {
    title,
    description,
    siteName: "decide",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#1f6f8a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${dmMono.variable} ${cyrillicMono.variable}`}>
        <AppSplash />
        {children}
        <SiteFooter />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
