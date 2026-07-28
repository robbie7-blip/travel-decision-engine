"use client";

import { useEffect, useState } from "react";
import { ItineraryResult } from "@/components/ItineraryResult";
import { DEFAULT_FORM_STATE, TripForm, toTripBriefInput, type TripFormState } from "@/components/TripForm";
import { ConfidenceDot } from "@/components/ui";
import { ApiError, generateItinerary, refineItinerary } from "@/lib/api";
import { LANGUAGE_NAMES, TRANSLATIONS } from "@/lib/i18n";
import type { Job } from "@/lib/jobs";
import type { Itinerary, Language, TripBriefInput } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

const LANGUAGE_STORAGE_KEY = "decide:language";

export default function Home() {
  const [form, setForm] = useState<TripFormState>(DEFAULT_FORM_STATE);
  const [status, setStatus] = useState<Status>("idle");
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [lastBrief, setLastBrief] = useState<TripBriefInput | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | undefined>(undefined);
  const [refining, setRefining] = useState(false);
  const [refineJobStatus, setRefineJobStatus] = useState<Job["status"] | null>(null);
  const [refineError, setRefineError] = useState("");

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
    setLastQuestion(undefined);
    setRefineError("");
    try {
      const brief = toTripBriefInput(form);
      const { jobId, itinerary } = await generateItinerary(brief, setJobStatus);
      setResult(itinerary);
      setResultJobId(jobId);
      setLastBrief(brief);
      setStatus("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.genericError);
      setStatus("error");
    }
  }

  async function handleRefine(question: string) {
    if (!result || !lastBrief) return;
    setRefining(true);
    setRefineJobStatus(null);
    setRefineError("");
    try {
      const { jobId, itinerary } = await refineItinerary(lastBrief, result, question, setRefineJobStatus);
      setResult(itinerary);
      setResultJobId(jobId);
      setLastQuestion(question);
    } catch (e) {
      setRefineError(e instanceof ApiError ? e.message : t.genericError);
    } finally {
      setRefining(false);
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "28px 24px 36px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 16,
              marginBottom: 26,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              {/* Optical alignment: the shield's ink starts ~18% into its viewBox
                  (flat left edge at x=18/100), so a flush box-left placement reads
                  as indented next to the headline below it — pulled left to compensate. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.svg" alt="" width={84} height={84} style={{ marginLeft: -15, flexShrink: 0 }} />
              <div>
                <div className="font-display" style={{ fontSize: 48, fontWeight: 600, lineHeight: 1, color: "var(--ink)" }}>
                  decide
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    color: "var(--accent-1)",
                    textTransform: "uppercase",
                    marginTop: 8,
                  }}
                >
                  {t.tagline}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 24, marginLeft: "auto" }}>
              <a
                href="#how-it-works"
                className="font-mono"
                style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}
              >
                {t.howItWorks}
              </a>
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
          </div>
          <h1
            className="font-display gradient-text"
            style={{
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: "clamp(32px, 6vw, 48px)",
              lineHeight: 1.25,
              paddingBottom: 6,
              margin: "0 0 10px",
            }}
          >
            {t.headline}
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: 0 }}>
            {t.subhead}
          </p>
          <div
            id="confidence-legend"
            className="font-mono"
            style={{ display: "flex", gap: 10, marginTop: 22, fontSize: 12, flexWrap: "wrap" }}
          >
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

      <div style={{ padding: "32px 24px", borderBottom: "1px solid var(--line)" }}>
        <div id="how-it-works" style={{ maxWidth: 960, margin: "0 auto", scrollMarginTop: 24 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 24,
            }}
          >
            {[
              { title: t.howItWorksSteps.step1Title, body: t.howItWorksSteps.step1Body },
              { title: t.howItWorksSteps.step2Title, body: t.howItWorksSteps.step2Body },
              { title: t.howItWorksSteps.step3Title, body: t.howItWorksSteps.step3Body },
            ].map((step, i) => (
              <div key={i}>
                <div
                  className="font-mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "var(--grounded)",
                    color: "var(--bg-panel)",
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 10,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{step.title}</div>
                <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 }}>{step.body}</div>
              </div>
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
            <ItineraryResult
              result={result}
              jobId={resultJobId}
              t={t}
              onRefine={handleRefine}
              refining={refining}
              refiningLabel={refineJobStatus ? t.jobStatus[refineJobStatus] : undefined}
              refineError={refineError}
              lastQuestion={lastQuestion}
            />
          </div>
        </div>
      )}
    </div>
  );
}
