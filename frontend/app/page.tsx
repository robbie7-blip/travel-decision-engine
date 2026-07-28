"use client";

import { useEffect, useState } from "react";
import { ItineraryResult } from "@/components/ItineraryResult";
import { DEFAULT_FORM_STATE, TripForm, toTripBriefInput, type TripFormState } from "@/components/TripForm";
import { ConfidenceDot } from "@/components/ui";
import { ApiError, generateItinerary } from "@/lib/api";
import { LANGUAGE_NAMES, TRANSLATIONS } from "@/lib/i18n";
import type { Job } from "@/lib/jobs";
import type { Itinerary, Language } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

const LANGUAGE_STORAGE_KEY = "decide:language";

export default function Home() {
  const [form, setForm] = useState<TripFormState>(DEFAULT_FORM_STATE);
  const [status, setStatus] = useState<Status>("idle");
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [resultJobId, setResultJobId] = useState<string | null>(null);

  const t = TRANSLATIONS[form.language];

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") {
      setForm((prev) => ({ ...prev, language: saved }));
    }
  }, []);

  function setLanguage(language: Language) {
    setForm((prev) => ({ ...prev, language }));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }

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
      setError(e instanceof ApiError ? e.message : t.genericError);
      setStatus("error");
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "48px 24px 36px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.svg" alt="" width={52} height={52} />
              <div>
                <div className="font-display" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1, color: "var(--ink)" }}>
                  decide
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    color: "var(--ink-dim)",
                    textTransform: "uppercase",
                    marginTop: 2,
                  }}
                >
                  {t.tagline}
                </div>
              </div>
            </div>
            <div
              className="font-mono"
              style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
            >
              {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  style={{
                    border: "none",
                    padding: "6px 12px",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    background: form.language === lang ? "var(--grounded)" : "transparent",
                    color: form.language === lang ? "var(--bg-panel)" : "var(--ink-dim)",
                  }}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
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
            {t.headline}
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
            {t.subhead}
          </p>
          <div className="font-mono" style={{ display: "flex", gap: 10, marginTop: 22, fontSize: 12, flexWrap: "wrap" }}>
            {(
              ["verified", "fact_grounded", "single_source", "conflicting", "inferred"] as const
            ).map((tier) => (
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
                <ConfidenceDot tier={tier} /> {t.tierLegend[tier]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <TripForm
            value={form}
            onChange={setForm}
            onSubmit={handleSubmit}
            submitting={status === "loading"}
            submittingLabel={jobStatus ? t.jobStatus[jobStatus] : undefined}
            t={t}
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
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <ItineraryResult result={result} jobId={resultJobId} t={t} />
          </div>
        </div>
      )}
    </div>
  );
}
