"use client";

import { useState } from "react";
import { ItineraryResult } from "@/components/ItineraryResult";
import { DEFAULT_FORM_STATE, TripForm, toTripBriefInput, type TripFormState } from "@/components/TripForm";
import { Dot } from "@/components/ui";
import { ApiError, generateItinerary } from "@/lib/api";
import type { Itinerary } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

export default function Home() {
  const [form, setForm] = useState<TripFormState>(DEFAULT_FORM_STATE);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Itinerary | null>(null);

  async function handleSubmit() {
    setStatus("loading");
    setError("");
    setResult(null);
    try {
      const itinerary = await generateItinerary(toTripBriefInput(form));
      setResult(itinerary);
      setStatus("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      setStatus("error");
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "48px 24px 36px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              color: "var(--ink-dim)",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Travel Decision Engine — Phase 1
          </div>
          <h1
            className="font-display"
            style={{
              fontWeight: 600,
              fontSize: "clamp(28px, 5vw, 42px)",
              lineHeight: 1.15,
              margin: "0 0 14px",
            }}
          >
            It doesn&apos;t list options. It decides.
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
            Every line below is either grounded in a checked fact or flagged as a guess — never both,
            never hidden. That distinction is the whole product.
          </p>
          <div className="font-mono" style={{ display: "flex", gap: 20, marginTop: 20, fontSize: 13 }}>
            <span style={{ color: "var(--ink-dim)", display: "flex", alignItems: "center" }}>
              <Dot grounded /> grounded in a fact
            </span>
            <span style={{ color: "var(--ink-dim)", display: "flex", alignItems: "center" }}>
              <Dot grounded={false} /> unverified guess
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <TripForm value={form} onChange={setForm} onSubmit={handleSubmit} submitting={status === "loading"} />
          {status === "error" && (
            <div className="font-mono" style={{ marginTop: 14, color: "var(--infeasible)", fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div style={{ padding: "36px 24px 64px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <ItineraryResult result={result} />
          </div>
        </div>
      )}
    </div>
  );
}
