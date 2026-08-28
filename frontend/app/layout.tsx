import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, DM_Mono, Inter } from "next/font/google";
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

// The interface font: nav, chips, labels, buttons, the whole generation
// view — everything that isn't a heading and isn't a number in a column.
//
// This used to be a monospace, which is why the header read as a terminal
// sitting under a warm serif headline. Swapping one mono for another only
// moved the problem around; the typewriter feel was the monospace itself,
// not the particular face. Inter is here rather than a more characterful
// sans because most of this text is 11–13px chips and labels, which is
// the exact size Inter was drawn for and the exact size a display-leaning
// sans falls apart at.
//
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600", "700"],
});

// The same typeface, Cyrillic only, so the Bulgarian site is set in the
// interface font rather than dropping to whatever the OS picks.
//
// Split into its own declaration instead of just adding "cyrillic" to the
// subsets above, because next/font preloads every declared subset: one
// list would put a <link rel="preload"> for the Cyrillic file on every
// English page, which downloads it for visitors who will never render a
// Cyrillic character. Declared separately with preload off, the
// stylesheet's unicode-range fetches it exactly on the pages that need
// it. Both resolve to Inter, so there is no seam between them.
const interCyrillic = Inter({
  subsets: ["cyrillic"],
  variable: "--font-ui-cyrillic",
  weight: ["400", "500", "600", "700"],
  preload: false,
});

// Kept for the places a monospace actually earns its keep — a column of
// times down a day, the admin diagnostics numbers — where equal-width
// digits line up and proportional ones don't. See .font-mono in
// globals.css, which is now a deliberate, narrow choice rather than the
// default for all interface text.
//
// Latin only, and that's fine: what's left in mono is digits, clock
// times and the English-only admin pages. DM Mono has no Cyrillic, so if
// a Bulgarian string ever lands in one of these, it'll fall through the
// stack to the system monospace rather than render in DM Mono.
const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
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
    // The font variables go on <html>, not <body>, so they are defined on
    // the same element as the :root block in globals.css. --font-body is
    // declared there as var(--font-ui), ... — and a custom property is
    // substituted against the element it is declared on, so with the
    // classes down on <body> that reference would resolve to nothing and
    // silently take the whole declaration with it.
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${interCyrillic.variable} ${dmMono.variable}`}
    >
      <body>
        <AppSplash />
        {children}
        <SiteFooter />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
