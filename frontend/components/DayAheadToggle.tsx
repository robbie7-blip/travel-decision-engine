"use client";

// "Email me each evening before a trip day" (lib/dayAhead.ts). Shown only
// to the signed-in account that planned this trip - the API decides that,
// so a shared link never shows it to anyone else.

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

export function DayAheadToggle({ jobId, t }: { jobId: string; t: Dictionary }) {
  const [state, setState] = useState<{ available: boolean; on: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    fetch(`/api/trip-reminders?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.available === "boolean") setState(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!state?.available) return null;

  async function toggle() {
    if (!state) return;
    setBusy(true);
    try {
      const response = await fetch("/api/trip-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, on: !state.on }),
      });
      if (response.ok) setState(await response.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={state.on}
      className="font-ui no-print trip-action"
    >
      <span aria-hidden>{state.on ? "✓" : "✉"}</span> {state.on ? t.result.dayAhead.on : t.result.dayAhead.turnOn}
    </button>
  );
}
