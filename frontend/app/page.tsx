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
import { HeroGallery } from "@/components/HeroGallery";
import { HeroSearch } from "@/components/HeroSearch";
import { ExampleTrip, type DemoWithPreview } from "@/components/ExampleTrip";
import { SiteHeader } from "@/components/SiteHeader";
import { TrustFooter } from "@/components/TrustFooter";
import { ConfidenceRule } from "@/components/ui";
import { ApiError, createGenerateJob } from "@/lib/api";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { trackHomeEvent } from "@/lib/homeEvents";
import { LAST_SEARCH_KEY, restoreLastSearch, serializeLastSearch } from "@/lib/lastSearch";
import { localDateOf } from "@/lib/today";
import { translatePartyComposition } from "@/lib/partyPresets";
import type { Language } from "@/lib/types";

type Status = "idle" | "loading" | "error";

/** Which of the two ways in was used, so a failure is reported next to the
 * button that was pressed rather than a screen away from it. */
type SubmitSource = "hero" | "form";

/** The bar opens on a couple, the way every booking site opens on two
 * adults: it is the commonest answer, and a required question with a
 * sensible answer already in it is one fewer thing between the visitor and
 * the button. It is visible in the bar and in the form, and one tap to
 * change. */
const INITIAL_FORM: TripFormState = {
  ...DEFAULT_FORM_STATE,
  party_size: "2",
  party_composition: TRANSLATIONS[DEFAULT_FORM_STATE.language].heroSearch.presets.couple.party,
};

/** A language switch, carrying a preset party description across with it
 * (see translatePartyComposition). */
function withLanguage(prev: TripFormState, language: Language): TripFormState {
  return { ...prev, language, party_composition: translatePartyComposition(prev.party_composition, language) };
}


export default function Home() {
  const router = useRouter();
  const { currency, setCurrency } = useCurrency();
  const [form, setForm] = useState<TripFormState>(INITIAL_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [submitSource, setSubmitSource] = useState<SubmitSource>("form");
  const [demo, setDemo] = useState<DemoWithPreview | null>(null);

  const t = TRANSLATIONS[form.language];

  useEffect(() => {
    // Zero-commitment homepage demo: only shows up once an admin has set a
    // real, already-generated trip via /admin/demo-trip - never a
    // fabricated example (see lib/demoTrip.ts).
    fetch("/api/demo-trip")
      .then((res) => res.json())
      .then((data) => setDemo(data.demo ?? null))
      .catch(() => setDemo(null));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // A ?lang= from a /destinations link takes priority over the saved
    // preference - it reflects where the visitor just came from - and gets
    // persisted so it sticks on the next visit too.
    const urlLang = params.get("lang");
    if (urlLang === "en" || urlLang === "bg") {
      setForm((prev) => withLanguage(prev, urlLang));
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, urlLang);
    } else {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === "en" || saved === "bg") {
        setForm((prev) => withLanguage(prev, saved));
      }
    }

    // Arriving from a /destinations/[slug] page's "Plan a trip to X" link -
    // prefill the destination instead of leaving the sample data in place.
    const dest = params.get("dest");
    if (dest) {
      setForm((prev) => ({ ...prev, destinations: dest }));
    } else {
      // Otherwise, the bar as it was left on this device (lib/lastSearch.ts).
      // A guide's "Plan a trip to X" wins over it, being the newer intent.
      let restored = null;
      try {
        restored = restoreLastSearch(window.localStorage.getItem(LAST_SEARCH_KEY), localDateOf(new Date()));
      } catch {
        // Storage refused (private mode, blocked site data): start empty.
      }
      if (restored) {
        setForm((prev) => {
          const next = { ...prev, ...restored };
          return { ...next, party_composition: translatePartyComposition(next.party_composition, prev.language) };
        });
      }
    }
  }, []);

  function setLanguage(language: Language) {
    setForm((prev) => withLanguage(prev, language));
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }

  /** Only once a trip was actually accepted: a search that failed is not
   * one worth coming back to. */
  function rememberSearch() {
    try {
      window.localStorage.setItem(LAST_SEARCH_KEY, serializeLastSearch(form));
    } catch {
      // A full or blocked storage costs the convenience, nothing else.
    }
  }

  async function handleSubmit(source: SubmitSource) {
    // The bar counts its own (HeroSearch.submitNow), with how the nudge
    // ended; this is the other way in.
    if (source === "form") trackHomeEvent("submit_form");
    setSubmitSource(source);
    setStatus("loading");
    setError("");
    try {
      const brief = toTripBriefInput(form);

      const compareDestinations = form.compareEnabled ? form.compareDestinations.trim() : "";
      if (compareDestinations) {
        // Same trip (dates/budget/party/pace/etc.) - only the destination
        // differs, and optionally the dates too - so both jobs are queued
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
        rememberSearch();
        router.push(`/compare?a=${jobIdA}&b=${jobIdB}`);
        return;
      }

      const jobId = await createGenerateJob(brief);
      rememberSearch();
      router.push(`/trip/${jobId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.genericError);
      setStatus("error");
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Back to variant="large" - the compact single-row header (tried
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
          flat light page has no moment in it. This is that moment - one
          deep band, the headline in warm off-white, everything below it
          light and workmanlike. Nothing decorative was added to get it.

          And now the band does the job, not only the argument: the search
          bar is in it. See components/HeroSearch.tsx for why. The order
          on a phone is headline, bar, the honesty line, then the photo -
          the photo used to sit between the visitor and every field on the
          page. */}
      <div className="hero" style={{ padding: "var(--hero-pad-top) clamp(32px, 8%, 180px) var(--hero-pad-bottom)", position: "relative" }}>
        {/* 1550 matches the large header variant's own cap above so this
            section's left edge lines up with the logo instead of drifting
            based on its own narrower 960 reading-width - same fix applied
            sitewide, just with a percentage-based width instead of a flat
            maxWidth so the margin actually scales with the real window. */}
        <div style={{ maxWidth: 1550, margin: "0 auto" }}>
          <div className="hero-grid">
            <div className="hero-copy">
              {/* What the product IS. The headline says how it behaves,
                  and to someone who has never heard of decide, "it decides
                  for you" does not yet say "trip plans". */}
              <p className="hero-eyebrow font-ui">{t.heroSearch.eyebrow}</p>
              <h1
                className="font-display"
                style={{
                  fontWeight: 600,
                  fontStyle: "italic",
                  fontSize: "clamp(32px, 6vw, 50px)",
                  lineHeight: 1.18,
                  paddingBottom: 4,
                  margin: "0 0 14px",
                }}
              >
                {t.headlineLine1}
                <br />
                {t.headlineLine2}
              </h1>
              <p className="hero-subhead">{t.subheadLine1}</p>
            </div>

            {/* The type stays on the green rather than over the
                photograph, which is what keeps the band's contrast a
                guarantee instead of a hope - see components/HeroGallery.tsx. */}
            <div className="hero-photo">
              <HeroGallery t={t} language={form.language} />
            </div>

            <div className="hero-search-area">
              <HeroSearch
                value={form}
                onChange={setForm}
                onSubmit={() => handleSubmit("hero")}
                submitting={status === "loading"}
                error={status === "error" && submitSource === "hero" ? error : null}
                t={t}
              />
            </div>

            {/* The promise, directly under the button it is a promise
                about: what comes back will say how sure it is of every
                line. It used to be the subhead, read before there was
                anything to be sure of. */}
            <div className="hero-trust">
              <div className="hero-trust-guarantee">
                <span className="hero-trust-lead font-display">{t.subheadLine2}</span>
                <div
                  id="confidence-legend"
                  className="font-ui scroll-row-mobile"
                  style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap", alignItems: "center" }}
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
              </div>
              <div className="hero-trust-aside font-ui">
                <span>{t.heroSearch.timing}</span>
              </div>
            </div>

            <div className="hero-recent">
              <RecentTrips t={t} />
            </div>
          </div>
        </div>
      </div>

      {demo && <ExampleTrip demo={demo} t={t} language={form.language} />}

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

      {/* The same form state as the bar above, so this is the bar with
          everything else showing - budget, pace, diet, the flight - rather
          than a second form to fill in from the start. */}
      <div
        id="trip-details"
        style={{ padding: "36px clamp(32px, 8%, 180px)", borderBottom: "1px solid var(--line)", position: "relative", scrollMarginTop: 12 }}
      >
        <div style={{ maxWidth: 1550, margin: "0 auto" }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <TripForm
            value={form}
            onChange={setForm}
            onSubmit={() => handleSubmit("form")}
            submitting={status === "loading"}
            t={t}
          />
          {status === "error" && submitSource === "form" && (
            <div className="font-ui" style={{ marginTop: 14, color: "var(--infeasible)", fontSize: 13 }}>
              {error}
            </div>
          )}
          {status !== "loading" && (
            <div style={{ marginTop: 16 }}>
              <p className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", margin: 0 }}>
                {t.form.reassurance}
              </p>
              {/* Two ways out of an empty destination field, side by side.
                  /spin was previously reachable only from the nav menu,
                  which is behind a tap on mobile - so the one person it was
                  built for, standing in front of the form with no
                  destination in mind, was the one person who never saw it. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", marginTop: 6 }}>
                <Link
                  href={form.language === "bg" ? "/destinations?lang=bg" : "/destinations"}
                  className="font-ui inline-link"
                  style={{
                    fontSize: 12,
                    color: "var(--grounded)",
                    textDecoration: "underline",
                    display: "inline-block",
                  }}
                >
                  {t.form.notSurePrompt}
                </Link>
                <Link
                  href={form.language === "bg" ? "/decide-for-me?lang=bg" : "/decide-for-me"}
                  className="font-ui inline-link"
                  style={{
                    fontSize: 12,
                    color: "var(--grounded)",
                    textDecoration: "underline",
                    display: "inline-block",
                  }}
                >
                  {t.form.spinPrompt}
                </Link>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      <TrustFooter t={t} />
    </div>
  );
}
