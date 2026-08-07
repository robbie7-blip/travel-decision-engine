"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CurrencySwitcher, useCurrency } from "./CurrencySwitcher";
import { ItineraryResult } from "./ItineraryResult";
import { SiteHeader } from "./SiteHeader";
import { useJobStatusMessage } from "./useJobStatusMessage";
import { LoadingScreen } from "./LoadingScreen";
import { Stamp } from "./ui";
import { ApiError, pollJob, refineItinerary } from "@/lib/api";
import { computeTrustScore } from "@/lib/trustScore";
import { formatMoney } from "@/lib/currency";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS, type Dictionary } from "@/lib/i18n";
import type { Job } from "@/lib/jobs";
import type { Itinerary, Language, TripBriefInput } from "@/lib/types";

interface ColumnState {
  jobStatus: Job["status"] | null;
  loadError: string;
  result: Itinerary | null;
  brief: TripBriefInput | null;
}

const EMPTY_COLUMN: ColumnState = { jobStatus: null, loadError: "", result: null, brief: null };

/** Polls one side of the comparison and gives it its own pushback/refine
 * handler — the same refineItinerary used on the single-trip page, just
 * instantiated per column instead of assumed to be a single job. On a
 * successful refine, swaps that column's job id into the URL's "a"/"b"
 * query param (via router.replace, not push — this is an in-place revision
 * of an existing column, not new navigation) so the comparison stays a
 * shareable link pointing at the latest version of each side. */
function useCompareColumn(jobId: string | null, paramKey: "a" | "b", t: Dictionary) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ColumnState>(EMPTY_COLUMN);
  const [currentJobId, setCurrentJobId] = useState<string | null>(jobId);
  const [lastQuestion, setLastQuestion] = useState<string | undefined>(undefined);
  const [refining, setRefining] = useState(false);
  const [refineJobStatus, setRefineJobStatus] = useState<Job["status"] | null>(null);
  const [refineError, setRefineError] = useState("");

  useEffect(() => {
    setCurrentJobId(jobId);
    if (!jobId) return;
    let cancelled = false;
    setState(EMPTY_COLUMN);

    pollJob(jobId, (status, brief) => {
      if (!cancelled) setState((prev) => ({ ...prev, jobStatus: status, brief }));
    })
      .then(({ itinerary, brief }) => {
        if (cancelled) return;
        setState({ jobStatus: "done", loadError: "", result: itinerary, brief });
      })
      .catch((e) => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loadError: e instanceof ApiError ? e.message : t.genericError }));
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function handleRefine(question: string) {
    if (!state.result || !state.brief) return;
    setRefining(true);
    setRefineJobStatus(null);
    setRefineError("");
    try {
      const { jobId: newJobId, itinerary, brief } = await refineItinerary(
        state.brief,
        state.result,
        question,
        setRefineJobStatus
      );
      setState({ jobStatus: "done", loadError: "", result: itinerary, brief });
      setLastQuestion(question);
      setCurrentJobId(newJobId);
      const params = new URLSearchParams(searchParams.toString());
      params.set(paramKey, newJobId);
      router.replace(`/compare?${params.toString()}`);
    } catch (e) {
      setRefineError(e instanceof ApiError ? e.message : t.genericError);
    } finally {
      setRefining(false);
    }
  }

  return { ...state, currentJobId, handleRefine, refining, refineJobStatus, refineError, lastQuestion };
}

function totalCost(itinerary: Itinerary): number {
  return (itinerary.days ?? []).reduce(
    (sum, day) => sum + day.items.reduce((daySum, item) => daySum + (item.cost_estimate_eur || 0), 0),
    0
  );
}

/** >=80/50% thresholds match trustScoreColor in ItineraryResult.tsx —
 * duplicated rather than exported since it's a two-line function tied to
 * this specific color scale, not worth a shared module for. */
function trustScoreColor(percent: number): string {
  if (percent >= 80) return "var(--grounded)";
  if (percent >= 50) return "var(--unverified)";
  return "var(--infeasible)";
}

export function CompareView() {
  const searchParams = useSearchParams();
  const jobIdA = searchParams.get("a");
  const jobIdB = searchParams.get("b");

  const { currency, setCurrency, rates } = useCurrency();
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);
  }, []);
  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  const columnA = useCompareColumn(jobIdA, "a", t);
  const columnB = useCompareColumn(jobIdB, "b", t);
  const bothDone = Boolean(columnA.result && columnB.result);
  // Hooks can't be called inside the columns.map() below, so both columns'
  // rotating status messages are computed here up front instead.
  const statusMessageA = useJobStatusMessage(columnA.jobStatus, t);
  const statusMessageB = useJobStatusMessage(columnB.jobStatus, t);
  const refiningMessageA = useJobStatusMessage(columnA.refineJobStatus, t);
  const refiningMessageB = useJobStatusMessage(columnB.refineJobStatus, t);

  const header = (
    <SiteHeader
      language={language}
      onLanguageChange={setLanguage}
      t={t}
      maxWidth={1400}
      extraControls={<CurrencySwitcher currency={currency} setCurrency={setCurrency} label={t.currencyLabel} />}
      contextLink={{ href: "/", label: `${t.compare.planAnother} →` }}
    />
  );

  if (!jobIdA || !jobIdB) {
    return (
      <div style={{ minHeight: "100%" }}>
        {header}
        <div style={{ padding: "36px 24px" }}>
          <div className="font-mono" style={{ maxWidth: 960, margin: "0 auto", fontSize: 14, color: "var(--infeasible)" }}>
            {t.compare.missingJobs}{" "}
            <a href="/" style={{ color: "var(--infeasible)" }}>
              {t.compare.planAnother} →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const columns = [
    { jobId: jobIdA, col: columnA, statusMessage: statusMessageA, refiningMessage: refiningMessageA },
    { jobId: jobIdB, col: columnB, statusMessage: statusMessageB, refiningMessage: refiningMessageB },
  ];

  return (
    <div style={{ minHeight: "100%" }}>
      {header}
      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 24px", color: "var(--brand-teal)" }}>
            {t.compare.heading}
          </h1>

          {bothDone && columnA.result && columnB.result && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
                gap: 16,
                marginBottom: 32,
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "16px 20px",
                background: "var(--bg-panel)",
              }}
            >
              {[columnA, columnB].map((col, i) => {
                if (!col.result) return null;
                const trust = computeTrustScore(col.result);
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="font-display" style={{ fontSize: 18, fontWeight: 600 }}>
                      {col.brief?.destinations.join(", ")}
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {col.result.budget_feasibility && (
                        <Stamp ok={col.result.budget_feasibility.feasible}>
                          {col.result.budget_feasibility.feasible ? t.result.budgetFeasible : t.result.budgetNotFeasible}
                        </Stamp>
                      )}
                      {trust.totalCount > 0 && (
                        <Stamp ok color={trustScoreColor(trust.percent)}>
                          {trust.percent}% {t.result.trustScoreLabel}
                        </Stamp>
                      )}
                    </div>
                    <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      {t.compare.totalCost}: {formatMoney(totalCost(col.result), currency, rates)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 32 }}>
            {columns.map(({ jobId, col, statusMessage, refiningMessage }, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                {!col.result && !col.loadError && (
                  <LoadingScreen message={statusMessage ?? t.trip.loading} destinations={col.brief?.destinations} t={t} />
                )}
                {col.loadError && (
                  <div className="font-mono" style={{ fontSize: 14, color: "var(--infeasible)" }}>
                    {col.loadError}
                  </div>
                )}
                {col.result && (
                  <ItineraryResult
                    result={col.result}
                    jobId={col.currentJobId ?? jobId}
                    t={t}
                    onRefine={col.handleRefine}
                    refining={col.refining}
                    refiningLabel={refiningMessage}
                    refineError={col.refineError}
                    lastQuestion={col.lastQuestion}
                    currency={currency}
                    rates={rates}
                    destinations={col.brief?.destinations}
                    startDate={col.brief?.start_date}
                    endDate={col.brief?.end_date}
                    partyComposition={col.brief?.party_composition}
                    interests={col.brief?.interests}
                    language={language}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
