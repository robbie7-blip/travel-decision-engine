"use client";

import { useState } from "react";
import { ItineraryResult } from "@/components/ItineraryResult";
import { DEFAULT_FORM_STATE, TripForm, toTripBriefInput, type TripFormState } from "@/components/TripForm";
import { ConfidenceDot } from "@/components/ui";
import { ApiError, generateItinerary } from "@/lib/api";
import type { Job } from "@/lib/jobs";
import type { Itinerary } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

const JOB_STATUS_LABEL: Record<Job["status"], string> = {
  pending: "Queued…",
  running: "Generating — checking live prices, this can take a minute or two…",
  done: "Done",
  error: "Failed",
};

export default function Home() {
  const [form, setForm] = useState<TripFormState>(DEFAULT_FORM_STATE);
  const [status, setStatus] = useState<Status>("idle");
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [resultJobId, setResultJobId] = useState<string | null>(null);

  async function handleSubmit() {
    setStatus("loading");
    setJobStatus(null);
    setError("");
    setResult(null);
    setResultJobId(null);
    try {
      const { jobId, itinerary } = await generateItinerary(toTripBriefInput(form), setJobStatus);
      setResult(itinerary);
      setResultJobId(jobId);
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
            className="font-mono eyebrow-badge"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              color: "var(--ink-dim)",
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            Travel Decision Engine — Phase 1
          </div>
          <h1
            className="font-display gradient-text"
            style={{
              fontWeight: 600,
              fontSize: "clamp(32px, 6vw, 48px)",
              lineHeight: 1.1,
              margin: "0 0 14px",
            }}
          >
            It doesn&apos;t list options. It decides.
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
            Every line below carries its own confidence — from two sources agreeing to a plain,
            hedged guess — never hidden, never overstated. That distinction is the whole product.
          </p>
          <div className="font-mono" style={{ display: "flex", gap: 10, marginTop: 22, fontSize: 12, flexWrap: "wrap" }}>
            {[
              { tier: "verified" as const, label: "2 sources agree" },
              { tier: "fact_grounded" as const, label: "grounded in a fact" },
              { tier: "single_source" as const, label: "single source" },
              { tier: "conflicting" as const, label: "sources disagree" },
              { tier: "inferred" as const, label: "unverified guess" },
            ].map(({ tier, label }) => (
              <span
                key={tier}
                style={{
                  color: "var(--ink-dim)",
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "5px 12px 5px 10px",
                }}
              >
                <ConfidenceDot tier={tier} /> {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <TripForm
            value={form}
            onChange={setForm}
            onSubmit={handleSubmit}
            submitting={status === "loading"}
            submittingLabel={jobStatus ? JOB_STATUS_LABEL[jobStatus] : undefined}
          />
          {status === "error" && (
            <div className="font-mono" style={{ marginTop: 14, color: "var(--infeasible)", fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {result && resultJobId && (
        <div style={{ padding: "36px 24px 64px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <ItineraryResult result={result} jobId={resultJobId} />
          </div>
        </div>
      )}
    </div>
  );
}
