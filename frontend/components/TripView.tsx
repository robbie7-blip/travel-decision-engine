"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddToShowcaseButton } from "./AddToShowcaseButton";
import { JobTimings } from "./JobTimings";
import { CurrencySwitcher, useCurrency } from "./CurrencySwitcher";
import { ItineraryResult } from "./ItineraryResult";
import { SiteHeader } from "./SiteHeader";
import { useJobStatusMessage } from "./useJobStatusMessage";
import { LoadingScreen } from "./LoadingScreen";
import { ApiError, pollJob, refineItinerary } from "@/lib/api";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { removeRecentTrip, saveRecentTrip } from "@/lib/recentTrips";
import type { Job, JobTimings as Timings, QualityReport } from "@/lib/jobs";
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
  const [timings, setTimings] = useState<Timings | undefined>(undefined);
  const [quality, setQuality] = useState<QualityReport | undefined>(undefined);
  const [refining, setRefining] = useState(false);
  const [refineJobStatus, setRefineJobStatus] = useState<Job["status"] | null>(null);
  const [refineError, setRefineError] = useState("");

  const t = TRANSLATIONS[language];
  const statusMessage = useJobStatusMessage(jobStatus, t);
  const refiningMessage = useJobStatusMessage(refineJobStatus, t);

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    setJobStatus(null);
    setCurrentJobId(jobId);

    pollJob(jobId, (status, brief) => {
      if (cancelled) return;
      setJobStatus(status);
      setLastBrief(brief);
    })
      .then(({ itinerary, brief, timings: t, quality: q }) => {
        if (cancelled) return;
        setResult(itinerary);
        setLastBrief(brief);
        setTimings(t);
        setQuality(q);
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
      {/* 1450, not this page's own 960px content width below — matches the
          header width used site-wide (see ask/page.tsx's SiteHeader call);
          this page's contextLink + full nav + lang toggle needed more than
          960 to avoid wrapping. */}
      <SiteHeader
        language={language}
        onLanguageChange={setLanguage}
        t={t}
        maxWidth={1450}
        extraControls={<CurrencySwitcher currency={currency} setCurrency={setCurrency} label={t.currencyLabel} />}
        contextLink={{ href: "/", label: `${t.trip.planAnother} →` }}
      />

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          {!result && !loadError && (
            <LoadingScreen message={statusMessage ?? t.trip.loading} destinations={lastBrief?.destinations} t={t} />
          )}
          {loadError && (
            <div className="font-ui" style={{ fontSize: 14, color: "var(--infeasible)" }}>
              {loadError}{" "}
              <Link href="/" style={{ color: "var(--infeasible)" }}>
                {t.trip.planAnother} →
              </Link>
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
                refiningLabel={refiningMessage}
                refineError={refineError}
                lastQuestion={lastQuestion}
                currency={currency}
                rates={rates}
                destinations={lastBrief?.destinations}
                startDate={lastBrief?.start_date}
                endDate={lastBrief?.end_date}
                partyComposition={lastBrief?.party_composition}
                interests={lastBrief?.interests}
                language={language}
              />
              <JobTimings timings={timings} quality={quality} />
              <AddToShowcaseButton jobId={currentJobId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
