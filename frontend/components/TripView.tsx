"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AddToShowcaseButton } from "./AddToShowcaseButton";
import { CurrencySwitcher, useCurrency } from "./CurrencySwitcher";
import { ItineraryResult } from "./ItineraryResult";
import { ApiError, pollJob, refineItinerary } from "@/lib/api";
import { LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { removeRecentTrip, saveRecentTrip } from "@/lib/recentTrips";
import type { Job } from "@/lib/jobs";
import type { Itinerary, Language, TripBriefInput } from "@/lib/types";

/** The page behind a shared/bookmarked /trip/[jobId] link. Loads a job cold
 * from its id — no client-side form state to fall back on — so everything
 * needed to render (the brief, for pushback; the itinerary; its language)
 * comes from the job record itself once it's fetched. */
export function TripView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { currency, setCurrency, rates } = useCurrency();
  const [language, setLanguageState] = useState<Language>("en");
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [currentJobId, setCurrentJobId] = useState(jobId);
  const [lastBrief, setLastBrief] = useState<TripBriefInput | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | undefined>(undefined);
  const [refining, setRefining] = useState(false);
  const [refineJobStatus, setRefineJobStatus] = useState<Job["status"] | null>(null);
  const [refineError, setRefineError] = useState("");

  const t = TRANSLATIONS[language];

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    setJobStatus(null);
    setCurrentJobId(jobId);

    pollJob(jobId, (status) => {
      if (!cancelled) setJobStatus(status);
    })
      .then(({ itinerary, brief }) => {
        if (cancelled) return;
        setResult(itinerary);
        setLastBrief(brief);
        const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (saved !== "en" && saved !== "bg") setLanguageState(brief.language);
        // Bookmarks this visit so a returning visitor can find their way
        // back from the homepage (see lib/recentTrips.ts) — no accounts,
        // just this browser's own localStorage.
        saveRecentTrip({
          jobId,
          destinations: brief.destinations,
          startDate: brief.start_date,
          endDate: brief.end_date,
          language: brief.language,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof ApiError ? e.message : t.trip.notFound);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function handleRefine(question: string) {
    if (!result || !lastBrief) return;
    setRefining(true);
    setRefineJobStatus(null);
    setRefineError("");
    try {
      const { jobId: newJobId, itinerary, brief } = await refineItinerary(lastBrief, result, question, setRefineJobStatus);
      setResult(itinerary);
      setLastBrief(brief);
      setLastQuestion(question);
      // The refined itinerary lives at a new job id — swap the bookmarked
      // entry over rather than leaving a stale duplicate pointing at the
      // pre-refinement version.
      removeRecentTrip(currentJobId);
      saveRecentTrip({
        jobId: newJobId,
        destinations: brief.destinations,
        startDate: brief.start_date,
        endDate: brief.end_date,
        language: brief.language,
      });
      setCurrentJobId(newJobId);
      router.push(`/trip/${newJobId}`);
    } catch (e) {
      setRefineError(e instanceof ApiError ? e.message : t.genericError);
    } finally {
      setRefining(false);
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
          }}
        >
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
            <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--grounded)" }}>
              decide
            </span>
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 24, marginLeft: "auto" }}>
            <a
              href="/"
              className="font-mono"
              style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}
            >
              {t.trip.planAnother} →
            </a>
            <CurrencySwitcher currency={currency} setCurrency={setCurrency} />
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
                    background: language === lang ? "var(--accent-green)" : "transparent",
                    color: language === lang ? "var(--bg-panel)" : "var(--ink-dim)",
                  }}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          {!result && !loadError && (
            <div className="font-mono" style={{ fontSize: 14, color: "var(--ink-dim)" }}>
              {jobStatus ? t.jobStatus[jobStatus] : t.trip.loading}
            </div>
          )}
          {loadError && (
            <div className="font-mono" style={{ fontSize: 14, color: "var(--infeasible)" }}>
              {loadError}{" "}
              <a href="/" style={{ color: "var(--infeasible)" }}>
                {t.trip.planAnother} →
              </a>
            </div>
          )}
          {result && (
            <>
              <ItineraryResult
                result={result}
                jobId={currentJobId}
                t={t}
                onRefine={handleRefine}
                refining={refining}
                refiningLabel={refineJobStatus ? t.jobStatus[refineJobStatus] : undefined}
                refineError={refineError}
                lastQuestion={lastQuestion}
                currency={currency}
                rates={rates}
              />
              <AddToShowcaseButton jobId={currentJobId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
