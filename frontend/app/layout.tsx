import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Literata, DM_Mono, Inter } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { AppSplash } from "@/components/AppSplash";
import { SiteFooter } from "@/components/SiteFooter";
import { TravelpayoutsDrive } from "@/components/TravelpayoutsDrive";
import { getSiteUrl } from "@/lib/siteUrl";
import { LAUNCH_DEVICES, launchImageHref, launchMediaQuery } from "@/lib/launchScreens";
import "./globals.css";

// The headline face. This was Fraunces, which had two problems at once:
// it's the display serif a lot of AI products picked in 2024, so the site
// read as one of them - and it ships no Cyrillic, so every heading on the
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

// Cyrillic comes with it, from this one declaration. `subsets` only
// decides what is PRELOADED; the stylesheet next/font generates carries
// every range the family has (Cyrillic, Greek, Latin Extended), each as
// its own file behind a unicode-range, fetched only when a character in
// that range is actually drawn. So English pages still never download a
// Cyrillic file, and the Bulgarian site still gets Literata.
//
// There used to be a second, Cyrillic-only declaration of each face, on
// the belief that the Latin one could not render Cyrillic. It could, and
// the second declaration's stylesheet ALSO carried the Latin range, under
// a different file name - so every first visit downloaded each Latin font
// twice: 304kB of fonts where 150kB were needed, measured on a throttled
// phone, and the single largest download on the homepage.
// The interface font: nav, chips, labels, buttons, the whole generation
// view - everything that isn't a heading and isn't a number in a column.
//
// This used to be a monospace, which is why the header read as a terminal
// sitting under a warm serif headline. Swapping one mono for another only
// moved the problem around; the typewriter feel was the monospace itself,
// not the particular face. Inter is here rather than a more characterful
// sans because most of this text is 11-13px chips and labels, which is
// the exact size Inter was drawn for and the exact size a display-leaning
// sans falls apart at.
//
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600", "700"],
});

// Kept for the places a monospace actually earns its keep - a column of
// times down a day, the admin diagnostics numbers - where equal-width
// digits line up and proportional ones don't. See .font-mono in
// globals.css, which is now a deliberate, narrow choice rather than the
// default for all interface text.
//
// Latin only, and that's fine: what's left in mono is digits, clock
// times and the English-only admin pages. DM Mono has no Cyrillic, so if
// a Bulgarian string ever lands in one of these, it'll fall through the
// stack to the system monospace rather than render in DM Mono.
// Not preloaded: since .font-mono stopped being the default for interface
// text, most pages - the homepage included - render no monospace at all,
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

const IMPACT_SITE_VERIFICATION = "c77826bc-750e-443a-bf77-4682a78faaaa";

const title = "decide - Travel decision engine";
const description = "It doesn't list options. It decides.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  // Every page names its own address, without the query string, as the one
  // to index. Search Console reported "Duplicate without user-selected
  // canonical": the same page reached as /pricing and /pricing?lang=bg (and
  // with tracking parameters) looked like copies with no say in which one
  // counts. "./" resolves to each page's own path. Pages with a real
  // Bulgarian address of their own (the guides, the blog, published plans)
  // set their own alternates and override this.
  alternates: { canonical: "./" },
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
    // declared there as var(--font-ui), ... - and a custom property is
    // substituted against the element it is declared on, so with the
    // classes down on <body> that reference would resolve to nothing and
    // silently take the whole declaration with it.
    <html
      lang="en"
      className={`${literata.variable} ${inter.variable} ${dmMono.variable}`}
    >
      {/* Installed-on-iOS launch screens. Without these iOS shows plain
          white - it does not read the manifest's background_color - so
          opening the app flashed white before AppSplash could paint.
          These images are that same splash, so the first frame is already
          the right screen. See lib/launchScreens.ts. React hoists these
          into <head>. */}
      {LAUNCH_DEVICES.map((device) => (
        <link
          key={launchImageHref(device)}
          rel="apple-touch-startup-image"
          href={launchImageHref(device)}
          media={launchMediaQuery(device)}
        />
      ))}
      {/* In <head> because Travelpayouts' installer looks for it there.
          See the component for why it costs nothing at load. */}
      <head>
        <TravelpayoutsDrive />
        {/* Skyscanner's affiliate network (Impact) proves the site is ours
            by finding this tag. Written by hand because Impact reads a
            `value` attribute, which Next's metadata API does not emit.
            Public by design: it is meant to be seen in the page source. */}
        <meta name="impact-site-verification" {...{ value: IMPACT_SITE_VERIFICATION }} />
      </head>
      <body>
        <AppSplash />
        {children}
        <SiteFooter />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
