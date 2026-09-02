import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Literata, DM_Mono, Inter } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { AppSplash } from "@/components/AppSplash";
import { SiteFooter } from "@/components/SiteFooter";
import { getSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

// The headline face. This was Fraunces, which had two problems at once:
// it's the display serif a lot of AI products picked in 2024, so the site
// read as one of them — and it ships no Cyrillic, so every heading on the
// Bulgarian site was quietly falling back to Georgia.
//
// Literata was drawn for e-readers, which is exactly the constraint this
// design has: the display face isn't only doing 38px hero lines, it's also
// doing 18-19px card titles and the logo. Faces with more display
// personality (Playfair, and Garamond from the other direction) thin out
// or break up at that size. Variable weight axis, so the 400/600 the
// layouts ask for come from one file rather than two.
const literata = Literata({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
});

// Cyrillic cuts of the same face, split out for the same reason as the
// interface font below: next/font preloads every declared subset, and a
// single list would preload the Cyrillic file on English pages. Off the
// preload list, the stylesheet's unicode-range fetches it only where a
// Cyrillic character actually renders.
const literataCyrillic = Literata({
  subsets: ["cyrillic"],
  variable: "--font-display-cyrillic",
  style: ["normal", "italic"],
  preload: false,
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
// Not preloaded: since .font-mono stopped being the default for interface
// text, most pages — the homepage included — render no monospace at all,
// and the preload links were pulling both weights down on every one of
// them. Dropping the hint doesn't stop the font loading where it's
// actually used; it just stops announcing it where it isn't.
const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
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
  // The colour the phone paints its own chrome with. It was still the old
  // teal, so on Android the browser bar sat in the previous brand colour
  // above a green site.
  themeColor: "#2c6a4c",
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
      className={`${literata.variable} ${literataCyrillic.variable} ${inter.variable} ${interCyrillic.variable} ${dmMono.variable}`}
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
