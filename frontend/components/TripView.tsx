"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AddToShowcaseButton } from "./AddToShowcaseButton";
import { JobTimings } from "./JobTimings";
import { CurrencySwitcher, useCurrency } from "./CurrencySwitcher";
import { ItineraryResult } from "./ItineraryResult";
import { SiteHeader } from "./SiteHeader";
import { useJobStatusMessage } from "./useJobStatusMessage";
import { TripBuilding } from "./TripBuilding";
import { TripFailed } from "./TripFailed";
import { ApiError, pollJob, refineItinerary, retryTrip } from "@/lib/api";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { removeRecentTrip, saveRecentTrip } from "@/lib/recentTrips";
import type { Job, JobTimings as Timings, QualityReport, JobProgress } from "@/lib/jobs";
import type { Itinerary, Language } from "@/lib/types";
import type { PublicTripBrief } from "@/lib/publicBrief";
import { tripFailureReason, type TripFailureReason } from "@/lib/tripFailure";

/** The page behind a shared/bookmarked /trip/[jobId] link. Loads a job cold
 * from its id - no client-side form state to fall back on - so everything
 * needed to render (the brief, for pushback; the itinerary; its language)
 * comes from the job record itself once it's fetched. */
export function TripView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { currency, setCurrency, rates } = useCurrency();
  const [language, setLanguageState] = useState<Language>("en");
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  // What the worker has finished so far, so the wait shows the trip being
  // built rather than a spinner. See components/TripBuilding.tsx.
  const [progress, setProgress] = useState<JobProgress | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  /** WHY the page has nothing to show, as a code rather than only a
   * sentence - which is what lets the failure view offer the one action
   * that can help instead of a link home for all of them. See
   * lib/tripFailure.ts. */
  const [failure, setFailure] = useState<TripFailureReason | null>(null);
  /** Bumped to start the poll again from scratch, which is what "Check
   * again" does. A state counter rather than location.reload(): a reload
   * throws away the language, the currency and the scroll position to
   * re-ask a question this effect can simply ask again. */
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  /** Whether this trip has already spent its one free retry, as reported
   * by the job record - so the button is absent rather than offered and
   * then refused. */
  const [retried, setRetried] = useState(false);
  const [result, setResult] = useState<Itinerary | null>(null);
  const [currentJobId, setCurrentJobId] = useState(jobId);
  // The PUBLIC brief - the six fields the page renders. It used to be the
  // whole TripBriefInput, held here only so handleRefine could post it
  // back, which is what kept the private half on a public endpoint. See
  // lib/publicBrief.ts.
  const [lastBrief, setLastBrief] = useState<PublicTripBrief | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | undefined>(undefined);
  const [timings, setTimings] = useState<Timings | undefined>(undefined);
  const [quality, setQuality] = useState<QualityReport | undefined>(undefined);
  const [refining, setRefining] = useState(false);
  const [refineJobStatus, setRefineJobStatus] = useState<Job["status"] | null>(null);
  // The pushback's answer and stage while it runs (see refineSteps).
  const [refineProgress, setRefineProgress] = useState<JobProgress | undefined>(undefined);
  const [refineError, setRefineError] = useState("");
  /** The id a failed pushback's revision was given, when it got that far.
   *
   * A refinement is commissioned the moment it is submitted - same model
   * call and same quota slot as a new trip - so a poll that fails
   * afterwards has NOT undone the work. Holding the id is what turns "it
   * broke" into "open it": the trip page then handles it finished, still
   * running, or stalled with a retry. See onRefinedJobId in lib/api.ts. */
  const [refineJobId, setRefineJobId] = useState<string | null>(null);

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
    setFailure(null);
    setJobStatus(null);
    setCurrentJobId(jobId);

    pollJob(jobId, (status, brief, jobProgress, alreadyRetried) => {
      if (cancelled) return;
      setJobStatus(status);
      setLastBrief(brief);
      setProgress(jobProgress);
      setRetried(Boolean(alreadyRetried));
    })
      // Destructured under their own names: `t` is the translations
      // object everywhere else in this file, and shadowing it with the
      // job's timings here was one rename away from a wrong-language bug.
      .then(({ itinerary, brief, timings: jobTimings, quality: jobQuality }) => {
        if (cancelled) return;
        setResult(itinerary);
        setLastBrief(brief);
        setTimings(jobTimings);
        setQuality(jobQuality);
        const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (saved !== "en" && saved !== "bg") setLanguageState(brief.language);
        // Bookmarks this visit so a returning visitor can find their way
        // back from the homepage (see lib/recentTrips.ts) - no accounts,
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
        // An error from anywhere else is not a diagnosis, so it gets the
        // generic one rather than being guessed at.
        setFailure(e instanceof ApiError ? tripFailureReason({ reason: e.reason }) : "failed");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, attempt]);

  /** Looks again, without generating anything.
   *
   * For the two failures where the trip is probably still on its way: a
   * wait that ran past the client's patience, and a request that never
   * got through. Starting a second generation for either would be the
   * mistake, so this re-runs the poll and nothing else. */
  function recheck() {
    setLoadError("");
    setFailure(null);
    setRetryError("");
    setAttempt((n) => n + 1);
  }

  /** Starts the generation again, which COSTS one.
   *
   * Only reachable for the failures where it can actually work (see
   * lib/tripFailure.ts), and the brief it regenerates from is read
   * server-side out of the job record - what this page holds is the public
   * brief, with the mobility, dietary, budget and origin fields stripped,
   * so a retry assembled here would have silently planned a different
   * trip. Navigates to the NEW job's page, which is where the progress
   * for it will appear. */
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      const newJobId = await retryTrip(currentJobId);
      // The dead link stops being offered as a bookmark the moment it is
      // known to be dead - the new one is saved by the usual path once it
      // finishes.
      removeRecentTrip(currentJobId);
      router.push(`/trip/${newJobId}`);
    } catch (e) {
      setRetryError(e instanceof ApiError ? e.message : t.trip.failed.failed.body);
    } finally {
      setRetrying(false);
    }
  }

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function handleRefine(question: string) {
    if (!result) return;
    setRefining(true);
    setRefineJobStatus(null);
    setRefineProgress(undefined);
    setRefineError("");
    setRefineJobId(null);
    try {
      // The CURRENT job id, not the one this page was opened with: after a
      // refinement they differ, and a second pushback has to build on the
      // revision the traveler is looking at.
      const { jobId: newJobId, itinerary, brief } = await refineItinerary(
        currentJobId,
        question,
        (status, revisionProgress) => {
          setRefineJobStatus(status);
          if (revisionProgress) setRefineProgress(revisionProgress);
        },
        setRefineJobId
      );
      setResult(itinerary);
      setLastBrief(brief);
      setLastQuestion(question);
      // The refined itinerary lives at a new job id - swap the bookmarked
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
      {/* 1450, not this page's own 960px content width below - matches the
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
            <TripBuilding
              progress={progress}
              destinations={lastBrief?.destinations}
              message={statusMessage ?? t.trip.loading}
              t={t}
              notify={
                jobStatus === "pending" || jobStatus === "running"
                  ? { jobId: currentJobId, language }
                  : undefined
              }
            />
          )}
          {loadError && (
            <TripFailed
              reason={failure ?? "failed"}
              detail={loadError}
              language={language}
              t={t}
              onRetry={retry}
              onRecheck={recheck}
              retrying={retrying}
              retryError={retryError}
              retried={retried}
            />
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
                refineProgress={refineProgress}
                refineError={refineError}
                refineJobId={refineJobId}
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
              {/* Neither belongs on paper: one is an owner-only
                  diagnostics panel, the other an admin action. */}
              <div className="no-print">
                <JobTimings timings={timings} quality={quality} />
                <AddToShowcaseButton jobId={currentJobId} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
