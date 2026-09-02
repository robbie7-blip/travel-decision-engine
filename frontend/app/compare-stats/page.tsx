// Thin wrapper so CompareStatsView's useSearchParams() has the Suspense
// boundary Next.js requires around it during static generation - same
// pattern as app/compare/page.tsx for itinerary comparison.

import { Suspense } from "react";
import { CompareStatsView } from "@/components/CompareStatsView";

export default function CompareStatsPage() {
  return (
    <Suspense fallback={null}>
      <CompareStatsView />
    </Suspense>
  );
}
