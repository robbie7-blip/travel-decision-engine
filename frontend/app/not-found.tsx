// The 404.
//
// Before this file existed, a mistyped URL got Next's built-in page:
// white, system font, "This page could not be found" beside a hairline
// rule. Every other surface on this site is parchment, Literata and a
// green rule, so that was the only page carrying none of the brand - and
// it is the page a visitor sees at the exact moment something has already
// gone wrong for them.
//
// The work is in components/DeadEndView.tsx, shared with app/error.tsx,
// and it has to be a client component: a not-found route is handed no
// searchParams, so ?lang=bg is unavailable here and the language has to
// come from localStorage.

import type { Metadata } from "next";
import { DeadEndView } from "@/components/DeadEndView";
import { SHARE_CARD } from "@/lib/shareCard";

export const metadata: Metadata = {
  title: "Page not found - decide",
  description: "That page isn't on the map.",
  openGraph: {
    title: "Page not found - decide",
    description: "That page isn't on the map.",
    ...SHARE_CARD,
  },
  // A 404 is not a page anybody should be sent to from search.
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <DeadEndView kind="not-found" />;
}
