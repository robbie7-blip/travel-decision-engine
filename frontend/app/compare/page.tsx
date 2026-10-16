// Thin wrapper so CompareView's useSearchParams() has the Suspense boundary
// Next.js requires around it during static generation - see
// components/CompareView.tsx for the actual page.

import { Suspense } from "react";
import { CompareView } from "@/components/CompareView";

export default function ComparePage() {
  return (
    // A screen's height held for the view, not nothing: it renders in the
    // browser (useSearchParams), and with an empty fallback the footer
    // drew at the top and was pushed down when it arrived - a layout
    // shift on every visit.
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <CompareView />
    </Suspense>
  );
}
