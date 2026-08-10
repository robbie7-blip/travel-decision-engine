import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
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

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
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
      <body className={`${fraunces.variable} ${plexMono.variable}`}>
        <AppSplash />
        {children}
        <SiteFooter />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
