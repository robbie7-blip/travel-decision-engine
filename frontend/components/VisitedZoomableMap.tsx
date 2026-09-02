"use client";

// One of the "Visualize" tabs - Been's "Zoomable": the same flat map as the
// default Map tab, wrapped in pinch/scroll-to-zoom + drag-to-pan. Uses
// react-zoom-pan-pinch rather than hand-rolled touch-gesture math - that's
// exactly the kind of multi-touch/momentum handling that's easy to get
// subtly wrong on real mobile Safari (see VisitedMap.tsx's own sizing bug
// history), so it's worth a small dependency instead of reinventing it.
//
// react-zoom-pan-pinch scales its content purely via a CSS transform, which
// (per the ResizeObserver spec) doesn't affect the content's own measured
// layout size - so VisitedMap's internal width-measuring ResizeObserver
// (see that file) stays stable through zoom/pan, no interaction between the
// two beyond the visual scaling itself.
//
// VisitedMap is given a fixedSize here rather than letting it measure its
// own wrapper: the wrapper here is react-zoom-pan-pinch's content div,
// which by default sizes itself to fit ITS content - a circular dependency
// against VisitedMap sizing itself to fit that same wrapper, which
// collapses both to ~0px. A fixed intrinsic size sidesteps the deadlock
// entirely and suits a pinch-zoom canvas better anyway (you're expected to
// zoom in, not have it pre-shrunk to the viewport).

import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { VisitedMap } from "./VisitedMap";
import type { Language } from "@/lib/types";

interface VisitedZoomableMapProps {
  visitedCodes: Set<string>;
  onToggle: (code: string) => void;
  visitedLabel: string;
  notVisitedLabel: string;
  untrackedLabel: string;
  language: Language;
  hint: string;
}

export function VisitedZoomableMap({ visitedCodes, onToggle, visitedLabel, notVisitedLabel, untrackedLabel, language, hint }: VisitedZoomableMapProps) {
  return (
    <div>
      <div
        style={{
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--line)",
          background: "var(--bg)",
        }}
      >
        <TransformWrapper initialScale={0.5} minScale={0.35} maxScale={6} centerOnInit doubleClick={{ mode: "zoomIn" }}>
          <TransformComponent wrapperStyle={{ width: "100%", height: 380 }} contentStyle={{ width: 700, height: 460 }}>
            <VisitedMap
              visitedCodes={visitedCodes}
              onToggle={onToggle}
              pendingCode={null}
              visitedLabel={visitedLabel}
              notVisitedLabel={notVisitedLabel}
              untrackedLabel={untrackedLabel}
              language={language}
              fixedSize={700}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
      <p className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8, textAlign: "center" }}>
        {hint}
      </p>
    </div>
  );
}
