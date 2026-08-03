"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CurrencySwitcher, useCurrency } from "./CurrencySwitcher";
import { ItineraryResult } from "./ItineraryResult";
import { useJobStatusMessage } from "./useJobStatusMessage";
import { LoadingScreen } from "./LoadingScreen";
import { Stamp } from "./ui";
import { ApiError, pollJob } from "@/lib/api";
import { computeTrustScore } from "@/lib/trustScore";
import { formatMoney } from "@/lib/currency";
import { LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Job } from "@/lib/jobs";
import type { Itinerary, Language, TripBriefInput } from "@/lib/types";

interface ColumnState {
  jobStatus: Job["status"] | null;
  loadError: string;
  result: Itinerary | null;
  brief: TripBriefInput | null;
}

const EMPTY_COLUMN: ColumnState = { jobStatus: null, loadError: "", result: null, brief: null };

/** Polls one side of the comparison — same pollJob used everywhere else,
 * just called twice (once per column) rather than once. */
function usePolledJob(jobId: string | null): ColumnState {
  const [state, setState] = useState<ColumnState>(EMPTY_COLUMN);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setState(EMPTY_COLUMN);

    pollJob(jobId, (status) => {
      if (!cancelled) setState((prev) => ({ ...prev, jobStatus: status }));
    })
      .then(({ itinerary, brief }) => {
        if (cancelled) return;
        setState({ jobStatus: "done", loadError: "", result: itinerary, brief });
      })
      .catch((e) => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loadError: e instanceof ApiError ? e.message : "Something went wrong." }));
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return state;
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

  const columnA = usePolledJob(jobIdA);
  const columnB = usePolledJob(jobIdB);
  const bothDone = Boolean(columnA.result && columnB.result);
  // Hooks can't be called inside the columns.map() below, so both columns'
  // rotating status messages are computed here up front instead.
  const statusMessageA = useJobStatusMessage(columnA.jobStatus, t);
  const statusMessageB = useJobStatusMessage(columnB.jobStatus, t);

  const header = (
    <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
      <div
        style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}
      >
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
          <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--grounded)" }}>
            decide
          </span>
        </a>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginLeft: "auto" }}>
          <a
            href="/"
            className="font-mono"
            style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}
          >
            {t.compare.planAnother} →
          </a>
          <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
    </div>
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

  const columns: Array<{ jobId: string; state: ColumnState; statusMessage?: string }> = [
    { jobId: jobIdA, state: columnA, statusMessage: statusMessageA },
    { jobId: jobIdB, state: columnB, statusMessage: statusMessageB },
  ];

  return (
    <div style={{ minHeight: "100%" }}>
      {header}
      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 24px", color: "var(--ink)" }}>
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
            {columns.map(({ jobId, state, statusMessage }, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                {!state.result && !state.loadError && (
                  <LoadingScreen message={statusMessage ?? t.trip.loading} />
                )}
                {state.loadError && (
                  <div className="font-mono" style={{ fontSize: 14, color: "var(--infeasible)" }}>
                    {state.loadError}
                  </div>
                )}
                {state.result && (
                  <ItineraryResult
                    result={state.result}
                    jobId={jobId}
                    t={t}
                    currency={currency}
                    rates={rates}
                    destinations={state.brief?.destinations}
                    startDate={state.brief?.start_date}
                    endDate={state.brief?.end_date}
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
