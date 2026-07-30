"use client";

// Lets an already-authenticated admin add the current /trip/[jobId] straight
// to the /showcase gallery, without copying the jobId over to
// /admin/showcase by hand. Deliberately has no auth of its own: a background
// fetch to /api/admin/showcase (protected by middleware.ts) only succeeds if
// this browser already has Basic Auth credentials cached for that realm
// (i.e. an admin who's previously logged into /admin/showcase or
// /admin/demo-trip) — every other visitor's browser has nothing cached, so
// the fetch 401s/503s and the button never renders. No separate admin
// session or role check to build or maintain.

import { useEffect, useState } from "react";
import type { ShowcaseTrip } from "@/lib/showcase";

type Visibility = "checking" | "hidden" | "visible";
type AddStatus = "idle" | "loading" | "added" | "error";

export function AddToShowcaseButton({ jobId }: { jobId: string }) {
  const [visibility, setVisibility] = useState<Visibility>("checking");
  const [status, setStatus] = useState<AddStatus>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/showcase")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { trips: ShowcaseTrip[] }) => {
        if (cancelled) return;
        setVisibility("visible");
        if (data.trips.some((t) => t.jobId === jobId)) setStatus("added");
      })
      .catch(() => {
        if (!cancelled) setVisibility("hidden");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (visibility !== "visible") return null;

  async function handleAdd() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/admin/showcase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("added");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={handleAdd}
        disabled={status === "loading" || status === "added"}
        className="font-mono"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 12,
          background: "transparent",
          color: status === "added" ? "var(--ink-dim)" : "var(--grounded)",
          cursor: status === "added" ? "default" : "pointer",
        }}
      >
        {status === "added" ? "✓ In showcase gallery" : status === "loading" ? "Adding…" : "+ Add to showcase"}
      </button>
      {status === "error" && <span style={{ fontSize: 12, color: "var(--infeasible)" }}>{error}</span>}
    </div>
  );
}
