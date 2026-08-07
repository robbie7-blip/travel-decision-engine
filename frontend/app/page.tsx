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
        extraControls={<CurrencySwitcher currency={currency} setCurrency={setCurrency} label={t.currencyLabel} />}
      />
      <div style={{ padding: "16px 24px 36px", borderBottom: "1px solid var(--line)", position: "relative" }}>
        {/* Decorative background elements */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 200,
            height: 200,
            opacity: 0.13,
            pointerEvents: "none",
          }}
          viewBox="0 0 200 200"
        >
          <circle cx="150" cy="50" r="60" fill="var(--color-blue)" />
          <circle cx="100" cy="120" r="80" fill="var(--color-purple)" />
        </svg>

        <div style={{ maxWidth: 960, margin: "0 auto", position: "relative", zIndex: 1 }}>
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
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 820, margin: 0 }}>
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
            style={{ display: "flex", gap: 10, marginTop: 22, fontSize: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            <svg style={{ width: 20, height: 20, opacity: 0.5, marginRight: 4 }} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-blue)" strokeWidth="1.5" />
              <path d="M 12 6 L 14 10 L 18 10 L 15 13 L 16 17 L 12 14 L 8 17 L 9 13 L 6 10 L 10 10 Z" fill="var(--color-blue)" opacity="0.4" />
            </svg>
            {(
              ["verified", "fact_grounded", "single_source", "conflicting", "inferred"] as const
            ).map((tier) => (
              <span
                key={tier}
                data-tier={tier}
                style={{
                  color: "var(--ink-dim)",
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "5px 12px 5px 10px",
                  transition: "all 0.2s ease",
                }}
              >
                <ConfidenceDot tier={tier} /> {t.tierLegend[tier]}
              </span>
            ))}
          </div>
          <RecentTrips t={t} />
        </div>
      </div>

      <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)" }}>
        <div id="how-it-works" style={{ maxWidth: 960, margin: "0 auto", scrollMarginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 18, textAlign: "center", color: "var(--brand-teal)" }}>
            {t.howItWorks}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
            }}
          >
            {[
              {
                title: t.howItWorksSteps.step1Title,
                body: t.howItWorksSteps.step1Body,
                icon: (
                  <svg viewBox="0 0 80 80" style={{ width: 52, height: 52, marginBottom: 12 }}>
                    <circle cx="40" cy="40" r="35" fill="rgba(31, 111, 138, 0.1)" stroke="var(--color-blue)" strokeWidth="2"/>
                    {/* y-offset tuned to 17.5 (not 20) so the drawn glyph
                        (y 8-37 pre-translate) centers on the circle's true
                        midpoint (y=40) instead of sitting a few px low —
                        was visibly offset from steps 2/3 below, which sit a
                        few px high with their own un-tuned offsets. */}
                    <g transform="translate(20, 17.5)">
                      <rect x="8" y="8" width="24" height="24" fill="none" stroke="var(--color-blue)" strokeWidth="2" rx="2"/>
                      <circle cx="20" cy="20" r="3" fill="var(--color-blue)"/>
                      <line x1="8" y1="32" x2="32" y2="32" stroke="var(--color-blue)" strokeWidth="2"/>
                      <line x1="8" y1="37" x2="32" y2="37" stroke="var(--color-blue)" strokeWidth="1.5" opacity="0.5"/>
                    </g>
                  </svg>
                )
              },
              {
                title: t.howItWorksSteps.step2Title,
                body: t.howItWorksSteps.step2Body,
                icon: (
                  <svg viewBox="0 0 80 80" style={{ width: 52, height: 52, marginBottom: 12 }}>
                    <circle cx="40" cy="40" r="35" fill="rgba(125, 91, 166, 0.1)" stroke="var(--color-purple)" strokeWidth="2"/>
                    {/* y-offset tuned to 19 (not 15) — see step 1's comment
                        above; this glyph's own bounds (y 5-37 pre-translate)
                        center a few px high of the circle's midpoint at the
                        untuned offset. */}
                    <g transform="translate(15, 19)">
                      <path d="M 25 5 L 35 15 L 25 25 L 15 15 Z" fill="var(--color-purple)" opacity="0.3" stroke="var(--color-purple)" strokeWidth="2"/>
                      <circle cx="25" cy="15" r="3" fill="var(--color-purple)"/>
                      <line x1="5" y1="35" x2="45" y2="35" stroke="var(--color-purple)" strokeWidth="2"/>
                      <circle cx="15" cy="35" r="2" fill="var(--color-purple)"/>
                      <circle cx="35" cy="35" r="2" fill="var(--color-purple)"/>
                    </g>
                  </svg>
                )
              },
              {
                title: t.howItWorksSteps.step3Title,
                body: t.howItWorksSteps.step3Body,
                icon: (
                  <svg viewBox="0 0 80 80" style={{ width: 52, height: 52, marginBottom: 12 }}>
                    <circle cx="40" cy="40" r="35" fill="rgba(232, 162, 63, 0.1)" stroke="var(--accent-2)" strokeWidth="2"/>
                    {/* y-offset tuned to 20 (not 15) — see step 1's comment
                        above; this glyph's bounds (y 5-35 pre-translate)
                        center a few px high of the circle's midpoint at the
                        untuned offset. */}
                    <g transform="translate(15, 20)">
                      <rect x="5" y="10" width="40" height="25" fill="none" stroke="var(--accent-2)" strokeWidth="2" rx="2"/>
                      <path d="M 15 10 L 20 5 L 25 10" fill="none" stroke="var(--accent-2)" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M 35 10 L 40 5 L 45 10" fill="none" stroke="var(--accent-2)" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="10" y1="25" x2="40" y2="25" stroke="var(--accent-2)" strokeWidth="1.5" opacity="0.5"/>
                      <line x1="10" y1="30" x2="35" y2="30" stroke="var(--accent-2)" strokeWidth="1.5" opacity="0.5"/>
                    </g>
                  </svg>
                )
              },
            ].map((step, i) => (
              <div key={i} data-step={i}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                  {step.icon}
                </div>
                <div
                  className="font-mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "var(--grounded)",
                    color: "var(--bg-panel)",
                    fontSize: 11,
                    fontWeight: 700,
                    margin: "0 auto 8px",
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, textAlign: "center" }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.45, textAlign: "center" }}>{step.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px", borderBottom: "1px solid var(--line)", position: "relative" }}>
        {/* Decorative background illustration */}
        <svg
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: 250,
            height: 250,
            opacity: 0.12,
            pointerEvents: "none",
          }}
          viewBox="0 0 250 250"
        >
          <circle cx="125" cy="125" r="100" fill="none" stroke="var(--accent-2)" strokeWidth="2" />
          <circle cx="125" cy="125" r="70" fill="none" stroke="var(--color-purple)" strokeWidth="2" />
          <circle cx="125" cy="125" r="40" fill="none" stroke="var(--color-blue)" strokeWidth="2" />
          <path d="M 125 25 L 225 125 L 125 225 L 25 125 Z" fill="none" stroke="var(--color-coral)" strokeWidth="1.5" opacity="0.5" />
        </svg>

        <div style={{ maxWidth: 960, margin: "0 auto", position: "relative", zIndex: 1 }}>
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
