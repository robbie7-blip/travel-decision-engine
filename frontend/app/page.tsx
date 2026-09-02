"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { ConfidenceRule } from "@/components/ui";
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
      {/* Back to variant="large" — the compact single-row header (tried
          briefly for cross-page consistency) read as a downgrade on the
          homepage specifically, which is the one page where a bigger
          entrance earns its keep. */}
      <SiteHeader
        variant="large"
        language={form.language}
        onLanguageChange={setLanguage}
        t={t}
        extraControls={<CurrencySwitcher currency={currency} setCurrency={setCurrency} label={t.currencyLabel} />}
      />
      {/* The hero reversed out of deep sea blue.
          The grey version of this page was accurate about what it removed
          and wrong about what it left: a travel product that opens on a
          flat light page has no moment in it. This is that moment — one
          deep band, the headline in warm off-white, everything below it
          light and workmanlike. Nothing decorative was added to get it. */}
      <div className="hero" style={{ padding: "44px clamp(32px, 8%, 180px) 40px", position: "relative" }}>
        {/* The two decorative circle blobs that used to sit here and at the
            bottom of the form section are gone. Large soft translucent
            overlapping circles are one of the most recognisable AI-product
            motifs going, and they were doing no work: pointer-events none,
            13% opacity, purely atmospheric. An editorial page earns its
            atmosphere from margin and type, not from wallpaper. */}

        {/* 1550 matches the large header variant's own cap above so this
            section's left edge lines up with the logo instead of drifting
            based on its own narrower 960 reading-width — same fix applied
            sitewide, just with a percentage-based width instead of a flat
            maxWidth so the margin actually scales with the real window. */}
        <div style={{ maxWidth: 1550, margin: "0 auto" }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1
            className="font-display"
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
          {/* The <br> is CSS-gated (.subhead-break, see globals.css), not
              unconditional like headlineLine1/2's above — on a narrow phone,
              subheadLine1 alone already wraps to 2-3 lines, and forcing
              subheadLine2 onto its own line after that stranded "guess."
              alone mid-paragraph and pushed the whole block to 4 lines. Below
              the breakpoint the <br> collapses to nothing and this falls
              back to the old space-joined natural wrap (3 lines on mobile).
              At/above it, the full 820 column is available and natural wrap
              was instead splitting mid-sentence-2 ("...never" / "overstated."
              on separate lines) — the forced break fixes that by always
              landing exactly on the sentence boundary. */}
          <p style={{ color: "var(--deep-soft)", fontSize: 16, lineHeight: 1.65, maxWidth: 820, margin: 0 }}>
            {t.subheadLine1} <br className="subhead-break" />
            {t.subheadLine2}
          </p>
          {demo && (
            <Link
              href={`/trip/${demo.jobId}`}
              className="font-ui"
              style={{
                display: "inline-block",
                marginTop: 16,
                fontSize: 13,
                color: "var(--grounded)",
                textDecoration: "underline",
              }}
            >
              {t.demo.seeExample.replace("{destination}", demo.destinations.join(" · "))}
            </Link>
          )}
          <div
            id="confidence-legend"
            className="font-ui scroll-row-mobile"
            style={{ display: "flex", gap: 10, marginTop: 22, fontSize: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            {(
              ["verified", "fact_grounded", "single_source", "conflicting", "inferred"] as const
            ).map((tier) => (
              <span
                key={tier}
                data-tier={tier}
                style={{
                  color: "var(--deep-soft)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ConfidenceRule tier={tier} />
                {t.tierLegend[tier]}
              </span>
            ))}
          </div>
          <RecentTrips t={t} />
        </div>
        </div>
      </div>

      <div style={{ padding: "18px clamp(32px, 8%, 180px)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 1550, margin: "0 auto" }}>
        {/* Was three cards, each with an 80px outlined circle holding an
            icon and a filled numbered circle beneath it, on a tinted
            gradient panel. Circles-with-icons in a three-up grid is the
            house style of every AI product landing page, and none of it
            said anything the words underneath didn't say better.

            An editorial guide numbers its steps and sets them in a row of
            columns divided by rules. The numeral does the work the circle
            was doing, at a size that reads as typography rather than as a
            badge. */}
        <div id="how-it-works" style={{ scrollMarginTop: 24 }}>
          <h2
            className="font-ui"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--brand-gold-ink)",
              margin: "0 0 24px",
              paddingBottom: 10,
              borderBottom: "2px solid var(--brand-gold-ink)",
            }}
          >
            {t.howItWorks}
          </h2>
          <div className="step-rows">
            {[
              { title: t.howItWorksSteps.step1Title, body: t.howItWorksSteps.step1Body },
              { title: t.howItWorksSteps.step2Title, body: t.howItWorksSteps.step2Body },
              { title: t.howItWorksSteps.step3Title, body: t.howItWorksSteps.step3Body },
            ].map((step, i) => (
              <div key={i} className="step-row">
                <div
                  className="font-display"
                  style={{ fontSize: 34, lineHeight: 1, color: "var(--line-strong)", marginBottom: 10 }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="font-display" style={{ fontSize: 19, fontWeight: 600, marginBottom: 6 }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6 }}>{step.body}</div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      <div style={{ padding: "36px clamp(32px, 8%, 180px)", borderBottom: "1px solid var(--line)", position: "relative" }}>
        <div style={{ maxWidth: 1550, margin: "0 auto" }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <TripForm
            value={form}
            onChange={setForm}
            onSubmit={handleSubmit}
            submitting={status === "loading"}
            t={t}
          />
          {status === "error" && (
            <div className="font-ui" style={{ marginTop: 14, color: "var(--infeasible)", fontSize: 13 }}>
              {error}
            </div>
          )}
          {status !== "loading" && (
            <div style={{ marginTop: 16 }}>
              <p className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", margin: 0 }}>
                {t.form.reassurance}
              </p>
              <Link
                href={form.language === "bg" ? "/destinations?lang=bg" : "/destinations"}
                className="font-ui inline-link"
                style={{
                  fontSize: 12,
                  color: "var(--grounded)",
                  textDecoration: "underline",
                  display: "inline-block",
                  marginTop: 6,
                }}
              >
                {t.form.notSurePrompt}
              </Link>
            </div>
          )}
        </div>
        </div>
      </div>

      <TrustFooter t={t} />
    </div>
  );
}
