// Thin wrapper so CompareView's useSearchParams() has the Suspense boundary
// Next.js requires around it during static generation - see
// components/CompareView.tsx for the actual page.

import { Suspense } from "react";
import { CompareView } from "@/components/CompareView";

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareView />
    </Suspense>
  );
}
