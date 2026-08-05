"use client";

import { useState } from "react";
import { ConfidenceDot, inputStyle, SectionLabel, Stamp } from "./ui";
import { WeatherStrip } from "./WeatherStrip";
import { TripQA } from "./TripQA";
import { submitFeedback } from "@/lib/api";
import { computeTrustScore } from "@/lib/trustScore";
import { downloadItineraryIcs } from "@/lib/exportIcs";
import { formatMoney, type Currency, type FxRates } from "@/lib/currency";
import type { FeedbackRating } from "@/lib/feedback";
import type { Dictionary } from "@/lib/i18n";
import type { GooglePriceLevel, Itinerary, ItineraryItem, Language } from "@/lib/types";

// Google's price_level is a 0-4 tier, not a literal per-person figure — shown
// as $ symbols rather than implying a precise amount Google doesn't actually
// give us.
const PRICE_LEVEL_SYMBOL: Record<GooglePriceLevel, string> = {
  free: "",
  inexpensive: "$",
  moderate: "$$",
  expensive: "$$$",
  very_expensive: "$$$$",
};

/** >=80% grounded reuses the same teal as the "verified" tier dot; below
 * 50% reuses the infeasible red — thresholds chosen to match, not clash
 * with, the per-item confidence colors already established elsewhere. */
function trustScoreColor(percent: number): string {
  if (percent >= 80) return "var(--grounded)";
  if (percent >= 50) return "var(--unverified)";
  return "var(--infeasible)";
}

/** Splits the model's free-text budget reasoning into sentences for display
 * as bullet points, since the reasoning itself is unstructured prose (no
 * schema field breaks it into a list) — a period/!/? followed by whitespace
 * and then a capital letter or a currency symbol is a safe-enough split
 * point given this app's plain, short-sentence prompt style (see WRITING
 * STYLE in the system prompt). Worst case a sentence splits oddly; the
 * underlying text is never altered or dropped either way. */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const feedbackButtonStyle = {
  fontSize: 11,
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--ink-dim)",
  cursor: "pointer",
  textDecoration: "underline",
} as const;

/** Per-item helpful/wrong feedback control — the start of the trust-feedback
 * loop. Deliberately low-friction: one click for "helpful", one click plus an
 * optional one-line comment for "wrong". */
function ItemFeedback({
  jobId,
  day,
  item,
  t,
}: {
  jobId: string;
  day: number;
  item: ItineraryItem;
  t: Dictionary;
}) {
  const [state, setState] = useState<"idle" | "commenting" | "submitting" | "done" | "error">("idle");
  const [comment, setComment] = useState("");

  async function send(rating: FeedbackRating, commentText?: string) {
    setState("submitting");
    try {
      await submitFeedback({ jobId, day, item, rating, comment: commentText });
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
        {t.result.feedbackThanks}
      </div>
    );
  }

  if (state === "commenting") {
    return (
      <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t.result.feedbackPlaceholder}
          className="font-mono"
          style={{
            fontSize: 11,
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "3px 6px",
            color: "var(--ink)",
            flex: 1,
            minWidth: 160,
          }}
        />
        <button type="button" onClick={() => send("wrong", comment)} className="font-mono" style={feedbackButtonStyle}>
          {t.result.feedbackSubmit}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4, display: "flex", gap: 12, alignItems: "center" }}>
      <button
        type="button"
        onClick={() => send("helpful")}
        disabled={state === "submitting"}
        className="font-mono"
        style={feedbackButtonStyle}
      >
        {t.result.feedbackHelpful}
      </button>
      <button
        type="button"
        onClick={() => setState("commenting")}
        disabled={state === "submitting"}
        className="font-mono"
        style={feedbackButtonStyle}
      >
        {t.result.feedbackWrong}
      </button>
      {state === "error" && (
        <span className="font-mono" style={{ fontSize: 11, color: "var(--infeasible)" }}>
          {t.result.feedbackFailed}
        </span>
      )}
    </div>
  );
}

function itemKey(day: number, index: number): string {
  return `${day}-${index}`;
}

/** The "how do we know this?" disclosure — a tier-specific plain-language
 * explanation (not just the dot color) plus the item's actual evidence
 * (source links, cross-check agreement) when there is any. Collapsed by
 * default so a long itinerary doesn't turn into a wall of links; this is
 * the one place that evidence now lives, replacing what used to be an
 * always-visible source-links row under every grounded item. */
function ItemEvidence({ item, t }: { item: ItineraryItem; t: Dictionary }) {
  const tier = item.confidence_tier ?? "inferred";
  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 12px",
        background: "var(--bg-panel-raised)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--ink-soft)",
        lineHeight: 1.5,
      }}
    >
      <div>{t.result.tierExplainer[tier]}</div>
      {item.source_urls && item.source_urls.length > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          {item.source_urls.map((url, si) => (
            <a
              key={si}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono"
              style={{ fontSize: 11, color: "var(--grounded)", textDecoration: "underline" }}
            >
              {item.source_urls!.length > 1 ? `${t.result.source} ${si + 1}` : t.result.source} ↗
            </a>
          ))}
          {item.source_agreement === "disagree" && (
            <span className="font-mono" style={{ fontSize: 11, color: "var(--unverified)" }}>
              ⚠ {t.result.sourcesDisagree}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface ItineraryResultProps {
  result: Itinerary;
  jobId: string;
  t: Dictionary;
  // Optional so callers without a job to refine (there are none left, but
  // keeping it optional costs nothing) can skip pushback entirely — it just
  // doesn't render. CompareView.tsx wires this up per column, each with its
  // own independent refine handler.
  onRefine?: (question: string) => void;
  refining?: boolean;
  refiningLabel?: string;
  refineError?: string;
  lastQuestion?: string;
  // Defaults to EUR/no rates — every cost figure just renders in EUR, the
  // currency the itinerary was actually generated and budget-checked in.
  currency?: Currency;
  rates?: FxRates | null;
  // Drives the weather outlook strip — omitted (strip just doesn't render)
  // if the caller doesn't have the brief handy for some reason. destinations/
  // startDate/endDate/partyComposition/interests double as the trip context
  // handed to the embedded <TripQA> box further down, so its answers are
  // tailored to this actual trip rather than generic.
  destinations?: string[];
  startDate?: string;
  endDate?: string;
  partyComposition?: string;
  interests?: string[];
  // Also just for the embedded <TripQA> box, so it answers in the same
  // language as the rest of the page rather than always defaulting to
  // English.
  language?: Language;
}

export function ItineraryResult({
  result,
  jobId,
  t,
  onRefine,
  refining = false,
  refiningLabel,
  refineError,
  lastQuestion,
  currency = "EUR",
  rates = null,
  destinations,
  startDate,
  endDate,
  partyComposition,
  interests,
  language = "en",
}: ItineraryResultProps) {
  const [question, setQuestion] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  function toggleEvidence(key: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submitQuestion() {
    const trimmed = question.trim();
    if (!trimmed || refining || !onRefine) return;
    onRefine(trimmed);
    setQuestion("");
  }

  const trustScore = computeTrustScore(result);

  return (
    <div>
      <h2
        className="font-display"
        style={{
          fontWeight: 600,
          fontSize: 22,
          lineHeight: 1.4,
          margin: "0 0 20px",
          color: "var(--ink)",
        }}
      >
        {result.trip_summary}
      </h2>

      {result.days && result.days.length > 0 && (
        <button
          type="button"
          onClick={() => downloadItineraryIcs(result, jobId)}
          className="font-mono"
          style={{
            marginBottom: 20,
            background: "none",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 12,
            color: "var(--ink-soft)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ⬇ {t.result.downloadCalendar}
        </button>
      )}

      {result.budget_feasibility && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Stamp ok={result.budget_feasibility.feasible}>
              {result.budget_feasibility.feasible ? t.result.budgetFeasible : t.result.budgetNotFeasible}
            </Stamp>
            {trustScore.totalCount > 0 && (
              <Stamp ok color={trustScoreColor(trustScore.percent)}>
                {trustScore.percent}% {t.result.trustScoreLabel}
              </Stamp>
            )}
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "14px 16px",
              background: "var(--bg-panel-raised)",
              border: "1px solid var(--line)",
              borderRadius: 8,
            }}
          >
            {trustScore.totalCount > 0 && (
              <p style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.5, margin: "0 0 10px" }}>
                {t.result.trustScoreDetail
                  .replace("{grounded}", String(trustScore.groundedCount))
                  .replace("{total}", String(trustScore.totalCount))}
              </p>
            )}
            <div style={{ color: "var(--ink-soft)", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              {t.result.minEstimate}: {formatMoney(result.budget_feasibility.min_realistic_total_eur, currency, rates)}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.6 }}>
              {splitIntoSentences(result.budget_feasibility.reasoning).map((sentence, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {sentence}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {destinations && destinations.length > 0 && startDate && endDate && (
        <WeatherStrip destinations={destinations} startDate={startDate} endDate={endDate} t={t} />
      )}

      {result.key_decisions && result.key_decisions.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <SectionLabel>{t.result.keyDecisions}</SectionLabel>
          {result.key_decisions.map((d, i) => (
            <div
              key={i}
              className="hover-card"
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 10px",
                marginTop: -1,
                borderTop: "1px solid var(--line)",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  color:
                    d.confidence === "high"
                      ? "var(--grounded)"
                      : d.confidence === "medium"
                        ? "var(--unverified)"
                        : "var(--ink-dim)",
                  width: 50,
                  flexShrink: 0,
                  paddingTop: 3,
                }}
              >
                {t.result.confidenceLevel[d.confidence]}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{d.decision}</div>
                <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 3 }}>{d.reasoning}</div>
                {d.alternative_considered && (
                  <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 3, fontStyle: "italic" }}>
                    {t.result.vs}: {d.alternative_considered}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.days &&
        result.days.map((day) => (
          <div key={day.day} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <span className="font-display" style={{ fontSize: 18, fontWeight: 600 }}>
                {t.result.day} {String(day.day).padStart(2, "0")}
              </span>
              <span className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {day.date}
              </span>
              {day.feasibility_flag && (
                <span className="font-mono" style={{ fontSize: 11, color: "var(--unverified)" }}>
                  ⚠ {day.feasibility_flag}
                </span>
              )}
            </div>
            {day.items.map((item, i) => {
              const key = itemKey(day.day, i);
              const expanded = expandedItems.has(key);
              return (
                <div
                  key={i}
                  className="hover-card"
                  style={{
                    display: "flex",
                    gap: 4,
                    padding: "10px 10px",
                    marginTop: -1,
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleEvidence(key)}
                    aria-expanded={expanded}
                    aria-label={expanded ? t.result.evidenceHide : t.result.evidenceShow}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <ConfidenceDot tier={item.confidence_tier ?? "inferred"} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</span>
                      <span className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                        {item.cost_estimate_eur === 0
                          ? t.result.free
                          : `${formatMoney(item.cost_estimate_eur, currency, rates)}${
                              t.result.inlineTierLabel[item.confidence_tier ?? "inferred"]
                                ? ` (${t.result.inlineTierLabel[item.confidence_tier ?? "inferred"]})`
                                : ""
                            }`}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                      {item.location} · {item.time}
                    </div>
                    {item.google_business_status && item.google_business_status !== "operational" ? (
                      <div className="font-mono" style={{ fontSize: 11, color: "var(--infeasible)", marginTop: 4 }}>
                        ⚠{" "}
                        {item.google_business_status === "closed_permanently"
                          ? t.result.closedPermanently
                          : t.result.closedTemporarily}
                      </div>
                    ) : (
                      item.google_rating != null && (
                        <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                          ★ {item.google_rating.toFixed(1)}
                          {item.google_rating_count != null &&
                            ` (${t.result.googleRatingCount.replace("{count}", String(item.google_rating_count))})`}
                          {item.google_price_level && item.google_price_level !== "free" && (
                            <> · {PRICE_LEVEL_SYMBOL[item.google_price_level]}</>
                          )}
                        </div>
                      )
                    )}
                    {item.google_maps_url && item.google_business_status !== "closed_permanently" && (
                      <a
                        href={item.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono"
                        style={{ fontSize: 11, color: "var(--grounded)", textDecoration: "underline", marginTop: 4, display: "inline-block" }}
                      >
                        {t.result.viewOnGoogleMaps} ↗
                      </a>
                    )}
                    {item.flight_search_url && (
                      <a
                        href={item.flight_search_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono"
                        style={{ fontSize: 11, color: "var(--grounded)", textDecoration: "underline", marginTop: 4, display: "inline-block" }}
                      >
                        {t.result.checkFlightPrices} ↗
                      </a>
                    )}
                    <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink-soft)" }}>{item.reasoning}</div>
                    <button
                      type="button"
                      onClick={() => toggleEvidence(key)}
                      className="font-mono"
                      style={{
                        marginTop: 6,
                        background: "none",
                        border: "none",
                        padding: 0,
                        fontSize: 11,
                        color: "var(--ink-dim)",
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                    >
                      {expanded ? t.result.evidenceHide : t.result.evidenceShow}
                    </button>
                    {expanded && <ItemEvidence item={item} t={t} />}
                    <ItemFeedback jobId={jobId} day={day.day} item={item} t={t} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {result.things_to_skip && result.things_to_skip.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <SectionLabel>{t.result.skipThis}</SectionLabel>
          {result.things_to_skip.map((s, i) => (
            <div key={i} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--infeasible)" }}>{s.item}</span>
              <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>{s.reasoning}</div>
            </div>
          ))}
        </div>
      )}

      {onRefine && (
      <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
        <SectionLabel>{t.result.pushbackLabel}</SectionLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitQuestion();
            }}
            placeholder={t.result.pushbackPlaceholder}
            disabled={refining}
            style={{ ...inputStyle, flex: 1, minWidth: 240 }}
          />
          <button
            type="button"
            onClick={submitQuestion}
            disabled={refining || !question.trim()}
            className="font-mono btn-primary"
            style={{
              padding: "10px 22px",
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: refining || !question.trim() ? "default" : "pointer",
            }}
          >
            {refining ? t.result.pushbackSubmitting : t.result.pushbackSubmit}
          </button>
        </div>
        {refining && refiningLabel && (
          <div className="font-mono" style={{ marginTop: 8, fontSize: 12, color: "var(--ink-dim)" }}>
            {refiningLabel}
          </div>
        )}
        {refineError && (
          <div className="font-mono" style={{ marginTop: 8, fontSize: 12, color: "var(--infeasible)" }}>
            {refineError}
          </div>
        )}
        {!refining && result.pushback_response && (
          <div
            style={{
              marginTop: 16,
              padding: "14px 16px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-panel-raised)",
            }}
          >
            {lastQuestion && (
              <div
                className="font-mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-dim)",
                  marginBottom: 6,
                }}
              >
                {t.result.pushbackYouAsked}:{" "}
                <span style={{ textTransform: "none", fontStyle: "italic" }}>{lastQuestion}</span>
              </div>
            )}
            <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6 }}>{result.pushback_response}</div>
          </div>
        )}
      </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
        <SectionLabel>{t.tripQA.sectionHeading}</SectionLabel>
        <TripQA
          context={{ destinations, start_date: startDate, end_date: endDate, party_composition: partyComposition, interests }}
          language={language}
          t={t}
        />
      </div>
    </div>
  );
}
