"use client";

// Password-protected (see middleware.ts) internal tool: paste the jobId of
// any already-generated /trip/[jobId], point the homepage's "see a real
// example" link at it. Client component (not a server page like
// /admin/feedback) since setting/clearing needs interactive POST/DELETE
// calls against /api/admin/demo-trip.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DemoTrip } from "@/lib/demoTrip";

type Status = "idle" | "loading" | "error";

export default function DemoTripAdminPage() {
  const [current, setCurrent] = useState<DemoTrip | null | undefined>(undefined); // undefined = not loaded yet
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/admin/demo-trip");
    const data = await res.json();
    setCurrent(data.demo ?? null);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSet() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/admin/demo-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setCurrent(data.demo);
      setJobId("");
      setStatus("idle");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  async function handleClear() {
    setStatus("loading");
    setError("");
    try {
      await fetch("/api/admin/demo-trip", { method: "DELETE" });
      setCurrent(null);
      setStatus("idle");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 640, margin: "0 auto", color: "var(--ink)" }}>
      <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
        Homepage demo trip
      </h1>
      <div style={{ color: "var(--ink-dim)", fontSize: 13, marginBottom: 24 }}>
        Points the homepage&apos;s &quot;see a real example&quot; link at an already-generated trip.{" "}
        <Link href="/admin/feedback" style={{ color: "var(--grounded)" }}>
          feedback →
        </Link>
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>CURRENT</div>
        {current === undefined && <div style={{ fontSize: 14 }}>Loading…</div>}
        {current === null && <div style={{ fontSize: 14, color: "var(--ink-dim)" }}>No demo trip set.</div>}
        {current && (
          <div style={{ fontSize: 14 }}>
            <div>
              <a href={`/trip/${current.jobId}`} target="_blank" rel="noreferrer" style={{ color: "var(--grounded)" }}>
                {current.destinations.join(" · ")}
              </a>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              job {current.jobId} · set {new Date(current.setAt).toLocaleString()}
            </div>
            <button
              type="button"
              onClick={handleClear}
              disabled={status === "loading"}
              style={{
                marginTop: 10,
                border: "1px solid var(--line)",
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                background: "transparent",
                color: "var(--infeasible)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="jobId"
          style={{
            flex: 1,
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 13,
            background: "var(--bg-panel)",
            color: "var(--ink)",
          }}
        />
        <button
          type="button"
          onClick={handleSet}
          disabled={status === "loading" || !jobId.trim()}
          style={{
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "8px 16px",
            fontSize: 13,
            background: "var(--grounded)",
            color: "var(--bg-panel)",
            cursor: "pointer",
          }}
        >
          Set
        </button>
      </div>
      {status === "error" && (
        <div style={{ marginTop: 10, color: "var(--infeasible)", fontSize: 13 }}>{error}</div>
      )}
    </div>
  );
}
