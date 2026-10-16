// Thin wrapper so CompareStatsView's useSearchParams() has the Suspense
// boundary Next.js requires around it during static generation - same
// pattern as app/compare/page.tsx for itinerary comparison.

import { Suspense } from "react";
import { CompareStatsView } from "@/components/CompareStatsView";

export default function CompareStatsPage() {
  return (
    // A screen's height held for the view, not nothing: it renders in the
    // browser (useSearchParams), and with an empty fallback the footer
    // drew at the top and was pushed down when it arrived - a layout
    // shift on every visit.
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <CompareStatsView />
    </Suspense>
  );
}
