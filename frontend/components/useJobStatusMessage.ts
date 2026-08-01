"use client";

// While a job is "running" — the only status that can take a minute or two
// — cycles through a handful of small status lines instead of showing one
// static "Generating…" message the whole wait, same idea as Booking.com/
// Wizzair's loading screens. Every other status (pending/done/error) just
// renders its normal static jobStatus label.

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import type { JobStatus } from "@/lib/jobs";

const ROTATE_INTERVAL_MS = 2800;

export function useJobStatusMessage(status: JobStatus | null, t: Dictionary): string | undefined {
  const [index, setIndex] = useState(0);
  const messages = t.runningMessages;

  useEffect(() => {
    if (status !== "running") {
      setIndex(0);
      return;
    }
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, messages]);

  if (!status) return undefined;
  if (status === "running") return messages[index];
  return t.jobStatus[status];
}
