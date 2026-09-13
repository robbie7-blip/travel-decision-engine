"use client";

// The line that only appears on paper.
//
// A printed itinerary that does not say where it came from is a page of
// text: no way back to the live version, the sources behind each item,
// Ask a Local, or a refine. This is the thing that makes the printout a
// copy OF something rather than a dead end.
//
// The host is read from window.location rather than written down. I first
// put "yourdecide.com" here as a literal, which is the same defect
// getSiteUrl was rewritten to fix a few commits ago: on a preview
// deployment, a staging host, or any future domain, a hardcoded origin
// prints a URL that does not resolve - and printed, there is nothing to
// click and nothing to correct it with. The one place the real host is
// always known is the browser that is doing the printing.
//
// Which means it cannot render on the server, so it renders empty and
// fills in after mount. That is invisible either way: this element is
// display:none except inside @media print, and printing only ever happens
// from a mounted page.

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

export function PrintColophon({ jobId, t }: { jobId: string; t: Dictionary }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    try {
      // host, not href: the printed line should be the canonical trip URL,
      // not whatever query string or fragment the reader happened to
      // arrive with.
      setUrl(`${window.location.host}/trip/${jobId}`);
    } catch {
      // No window, no line. Nothing to fall back to that would be true.
    }
  }, [jobId]);

  if (!url) return null;

  return (
    <div className="print-only print-colophon">
      <span>{t.result.printedFrom}</span> <span className="print-url">{url}</span>
    </div>
  );
}
