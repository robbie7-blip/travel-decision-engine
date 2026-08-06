"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  compareDateOverride,
  DEFAULT_FORM_STATE,
  splitList,
  TripForm,
  toTripBriefInput,
  type TripFormState,
} from "@/components/TripForm";
import { CurrencySwitcher, useCurrency } from "@/components/CurrencySwitcher";
import { RecentTrips } from "@/components/RecentTrips";
import { SiteHeader } from "@/components/SiteHeader";
import { TrustFooter } from "@/components/TrustFooter";
import { ConfidenceDot } from "@/components/ui";
import { ApiError, createGenerateJob } from "@/lib/api";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

type Status = "idle" | "loading" | "error";

interface DemoTrip {
  jobId: string;
  destinations: string[];
}

export default function Home() {
  const router = useRouter();
  const { currency, setCurrency } = useCurrency();
  const [form, setForm] = useState<TripFormState>(DEFAULT_FORM_STATE);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [demo, setDemo] = useState<DemoTrip | null>(null);

  const t = TRANSLATIONS[form.language];

  useEffect(() => {
    // Zero-commitment homepage demo: only shows up once an admin has set a
    // real, already-generated trip via /admin/demo-trip — never a
    // fabricated example (see lib/demoTrip.ts).
    fetch("/api/demo-trip")
      .then((res) => res.json())
      .then((data) => setDemo(data.demo ?? null))
      .catch(() => setDemo(null));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // A ?lang= from a /destinations link takes priority over the saved
    // preference — it reflects where the visitor just came from — and gets
    // persisted so it sticks on the next visit too.
    const urlLang = params.get("lang");
    if (urlLang === "en" || urlLang === "bg") {
      setForm((prev) => ({ ...prev, language: urlLang }));
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, urlLang);
    } else {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === "en" || saved === "bg") {
        setForm((prev) => ({ ...prev, language: saved }));
      }
    }

    // Arriving from a /destinations/[slug] page's "Plan a trip to X" link —
    // prefill the destination instead of leaving the sample data in place.
    const dest = params.get("dest");
    if (dest) {
      setForm((prev) => ({ ...prev, destinations: dest }));
    }
  }, []);

  function setLanguage(language: Language) {
    setForm((prev) => ({ ...prev, language }));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }

  async function handleSubmit() {
    setStatus("loading");
    setError("");
    try {
      const brief = toTripBriefInput(form);

      const compareDestinations = form.compareEnabled ? form.compareDestinations.trim() : "";
      if (compareDestinations) {
        // Same trip (dates/budget/party/pace/etc.) — only the destination
        // differs, and optionally the dates too — so both jobs are queued
        // from the same brief with just those fields swapped, same as any
        // other generation (same rate limit, same spend cap, just twice).
        // Different dates matter in practice: direct-flight availability
        // often differs by route, so forcing identical dates on both sides
        // can silently price in a worse routing on one side.
        const compareBrief = {
          ...brief,
          destinations: splitList(compareDestinations),
          ...compareDateOverride(form),
        };
        const [jobIdA, jobIdB] = await Promise.all([createGenerateJob(brief), createGenerateJob(compareBrief)]);
        router.push(`/compare?a=${jobIdA}&b=${jobIdB}`);
        return;
      }

      const jobId = await createGenerateJob(brief);
      router.push(`/trip/${jobId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.genericError);
      setStatus("error");
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <SiteHeader
        variant="large"
        language={form.language}
        onLanguageChange={setLanguage}
        t={t}
        extraControls={<CurrencySwitcher currency={currency} setCurrency={setCurrency} />}
      />
      <div style={{ padding: "32px 24px 36px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
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
            {t.headlineLine1}
            <br />
            {t.headlineLine2}
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: 0 }}>
            {t.subheadLine1}
            <br />
            {t.subheadLine2}
          </p>
          {demo && (
            <a
              href={`/trip/${demo.jobId}`}
              className="font-mono"
              style={{
                display: "inline-block",
                marginTop: 16,
                fontSize: 13,
                color: "var(--grounded)",
                textDecoration: "underline",
              }}
            >
              {t.demo.seeExample.replace("{destination}", demo.destinations.join(" · "))}
            </a>
          )}
          <div
            id="confidence-legend"
            className="font-mono scroll-row-mobile"
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
          <RecentTrips t={t} />
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
            t={t}
          />
          {status === "error" && (
            <div className="font-mono" style={{ marginTop: 14, color: "var(--infeasible)", fontSize: 13 }}>
              {error}
            </div>
          )}
          {status !== "loading" && (
            <div style={{ marginTop: 16 }}>
              <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", margin: 0 }}>
                {t.form.reassurance}
              </p>
              <a
                href={form.language === "bg" ? "/destinations?lang=bg" : "/destinations"}
                className="font-mono"
                style={{
                  fontSize: 12,
                  color: "var(--grounded)",
                  textDecoration: "underline",
                  display: "inline-block",
                  marginTop: 6,
                }}
              >
                {t.form.notSurePrompt}
              </a>
            </div>
          )}
        </div>
      </div>

      <TrustFooter t={t} />
    </div>
  );
}
