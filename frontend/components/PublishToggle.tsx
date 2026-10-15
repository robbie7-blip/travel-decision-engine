"use client";

// "Publish as a public guide" (app/api/trip-publish). Shown only to the
// signed-in account that planned the trip; the API decides that.

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

export function PublishToggle({ jobId, t }: { jobId: string; t: Dictionary }) {
  const [state, setState] = useState<{ available: boolean; slug: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = t.result.publish;

  useEffect(() => {
    let cancelled = false;
    setState(null);
    fetch(`/api/trip-publish?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" })
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

  async function set(publish: boolean) {
    if (publish && !window.confirm(copy.confirm)) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/trip-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, publish }),
      });
      if (!response.ok) throw new Error();
      setState(await response.json());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!state.slug) {
    return (
      <button type="button" onClick={() => void set(true)} disabled={busy} className="font-ui no-print trip-action">
        <span aria-hidden>↗</span> {failed ? copy.failed : copy.button}
      </button>
    );
  }
  return (
    <span className="font-ui no-print trip-action publish-state">
      <span aria-hidden>✓</span> {copy.published} ·{" "}
      <Link href={`/plans/${state.slug}`} className="inline-link">
        {copy.view}
      </Link>{" "}
      ·{" "}
      <button type="button" onClick={() => void set(false)} disabled={busy} className="publish-undo">
        {copy.unpublish}
      </button>
    </span>
  );
}
