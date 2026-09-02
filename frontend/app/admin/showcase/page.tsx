"use client";

// Password-protected (see middleware.ts): curate which real, already
// generated trips show up on the public /showcase gallery. Client component
// (not a server page like /admin/feedback) since adding/removing needs
// interactive POST/DELETE calls against /api/admin/showcase.

import { useEffect, useState } from "react";
import Link from "next/link";
import { markAdminUi } from "@/lib/adminUi";
import type { ShowcaseTrip } from "@/lib/showcase";

type Status = "idle" | "loading" | "error";

export default function ShowcaseAdminPage() {
  const [trips, setTrips] = useState<ShowcaseTrip[] | undefined>(undefined); // undefined = not loaded yet
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/admin/showcase");
    const data = await res.json();
    setTrips(data.trips ?? []);
  }

  useEffect(() => {
    // Reaching this page at all means middleware.ts already required Basic
    // Auth to succeed - see lib/adminUi.ts for why AddToShowcaseButton reads
    // this flag instead of probing a protected endpoint on every visitor's
    // /trip/[jobId] page load.
    markAdminUi();
    load();
  }, []);

  async function handleAdd() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/admin/showcase", {
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
      setTrips(data.trips);
      setJobId("");
      setStatus("idle");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  async function handleRemove(id: string) {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/admin/showcase", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id }),
      });
      const data = await res.json();
      setTrips(data.trips);
      setStatus("idle");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", color: "var(--ink)" }}>
      <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
        Showcase gallery
      </h1>
      <div style={{ color: "var(--ink-dim)", fontSize: 13, marginBottom: 24 }}>
        Curates the real trips shown on{" "}
        <Link href="/showcase" style={{ color: "var(--grounded)" }}>
          /showcase →
        </Link>{" "}
        ·{" "}
        <Link href="/admin/demo-trip" style={{ color: "var(--grounded)" }}>
          homepage demo →
        </Link>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
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
          onClick={handleAdd}
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
          Add
        </button>
      </div>
      {status === "error" && <div style={{ marginBottom: 16, color: "var(--infeasible)", fontSize: 13 }}>{error}</div>}

      {trips === undefined && <div style={{ fontSize: 14 }}>Loading…</div>}
      {trips && trips.length === 0 && <div style={{ fontSize: 14, color: "var(--ink-dim)" }}>No trips in the showcase yet.</div>}

      {trips?.map((trip) => (
        <div
          key={trip.jobId}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 10,
          }}
        >
          <div>
            <a href={`/trip/${trip.jobId}`} target="_blank" rel="noreferrer" style={{ color: "var(--grounded)", fontSize: 14 }}>
              {trip.destinations.join(" · ")}
            </a>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
              job {trip.jobId} · added {new Date(trip.addedAt).toLocaleString()}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleRemove(trip.jobId)}
            disabled={status === "loading"}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: "6px 12px",
              fontSize: 12,
              background: "transparent",
              color: "var(--infeasible)",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
