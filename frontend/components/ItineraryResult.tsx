"use client";

import { Fragment, useState } from "react";
import { ConfidenceTag, inputStyle, SectionLabel, Stamp } from "./ui";
import { WeatherStrip } from "./WeatherStrip";
import { TripQA } from "./TripQA";
import { TripVisitedPrompt } from "./TripVisitedPrompt";
import { DayMap } from "./DayMap";
import { TripCover } from "./TripCover";
import { DayPhoto } from "./DayPhoto";
import { TravelLegRow } from "./TravelLeg";
import { OfflineReady } from "./OfflineReady";
import { travelLegsFor, type TravelLeg } from "@/lib/engine/travel";
import { submitFeedback } from "@/lib/api";
import { computeTrustScore } from "@/lib/trustScore";
import { downloadItineraryIcs } from "@/lib/exportIcs";
import { formatMoney, type Currency, type FxRates } from "@/lib/currency";
import { hoursLineFor, splitIntoSentences } from "@/lib/resultFormat";
import { safeHref } from "@/lib/linkify";
import type { FeedbackRating } from "@/lib/feedback";
import type { Dictionary } from "@/lib/i18n";
import type { GooglePriceLevel, Itinerary, ItineraryItem, Language } from "@/lib/types";

// Google's price_level is a 0-4 tier, not a literal per-person figure - shown
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
 * 50% reuses the infeasible red - thresholds chosen to match, not clash
 * with, the per-item confidence colors already established elsewhere. */
function trustScoreColor(percent: number): string {
  if (percent >= 80) return "var(--grounded)";
  if (percent >= 50) return "var(--unverified)";
  return "var(--infeasible)";
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

/** Per-item helpful/wrong feedback control - the start of the trust-feedback
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
      <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
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
          className="font-ui"
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
        <button type="button" onClick={() => send("wrong", comment)} className="font-ui" style={feedbackButtonStyle}>
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
        className="font-ui"
        style={feedbackButtonStyle}
      >
        {t.result.feedbackHelpful}
      </button>
      <button
        type="button"
        onClick={() => setState("commenting")}
        disabled={state === "submitting"}
        className="font-ui"
        style={feedbackButtonStyle}
      >
        {t.result.feedbackWrong}
      </button>
      {state === "error" && (
        <span className="font-ui" style={{ fontSize: 11, color: "var(--infeasible)" }}>
          {t.result.feedbackFailed}
        </span>
      )}
    </div>
  );
}

/** Identity for one itinerary row, for React's reconciler and for the
 * expanded-evidence set.
 *
 * Deliberately built from the item's own content rather than its position.
 * A refine ("swap the Tuesday dinner") returns a whole new itinerary, and
 * with a positional key React reused the existing DOM node for whatever now
 * sits at that index - so an evidence panel the traveler had opened stayed
 * open on a DIFFERENT venue, showing the previous place's source links
 * under the new place's name, and the per-item feedback control kept the
 * "thanks" state it earned for a rating of something else entirely. Both of
 * those are the trust surface; getting them wrong is worse than a visual
 * glitch.
 *
 * The index stays in the key as a tiebreaker, because two rows in one day
 * legitimately can share a time and title (a two-part activity split across
 * a lunch break), and React keys have to be unique among siblings. */
function itemKey(day: number, index: number, item: ItineraryItem): string {
  return `${day}|${item.time ?? ""}|${item.venue_name ?? item.title ?? ""}|${index}`;
}

/** The "how do we know this?" disclosure - a tier-specific plain-language
 * explanation (not just the dot color) plus the item's actual evidence
 * (source links, cross-check agreement) when there is any. Collapsed by
 * default so a long itinerary doesn't turn into a wall of links; this is
 * the one place that evidence now lives, replacing what used to be an
 * always-visible source-links row under every grounded item. */
function ItemEvidence({ item, t }: { item: ItineraryItem; t: Dictionary }) {
  const tier = item.confidence_tier ?? "inferred";
  // source_urls is written directly by the model (see types.ts), and this
  // was `href={url}` with no scheme check while lib/linkify.ts enforced
  // http/https for Ask a Local answers a few files away. A browser executes
  // href="javascript:..." on click, and the brief's free-text fields are
  // traveller-supplied. Anything safeHref rejects renders as no link at all.
  const sourceLinks = (item.source_urls ?? [])
    .map((url) => (typeof url === "string" ? safeHref(url) : null))
    .filter((href): href is string => href !== null);
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
      {sourceLinks.length > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          {sourceLinks.map((href, si) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-ui"
              style={{ fontSize: 11, color: "var(--grounded)", textDecoration: "underline" }}
            >
              {sourceLinks.length > 1 ? `${t.result.source} ${si + 1}` : t.result.source} ↗
            </a>
          ))}
          {item.source_agreement === "disagree" && (
            <span className="font-ui" style={{ fontSize: 11, color: "var(--unverified)" }}>
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
  // keeping it optional costs nothing) can skip pushback entirely - it just
  // doesn't render. CompareView.tsx wires this up per column, each with its
  // own independent refine handler.
  onRefine?: (question: string) => void;
  refining?: boolean;
  refiningLabel?: string;
  refineError?: string;
  lastQuestion?: string;
  // Defaults to EUR/no rates - every cost figure just renders in EUR, the
  // currency the itinerary was actually generated and budget-checked in.
  currency?: Currency;
  rates?: FxRates | null;
  // Drives the weather outlook strip - omitted (strip just doesn't render)
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

  // Every day's legs, computed once here rather than inside the day loop,
  // which returns its JSX directly and has nowhere to put a local. Keyed
  // `day:fromIndex` so a row can find the leg that starts at it in one
  // lookup. Days with fewer than two coordinate-bearing stops contribute
  // nothing, which is every day when there is no Places key - the same
  // way DayMap renders nothing.
  const legsByRow = new Map<string, TravelLeg>();
  for (const day of result.days ?? []) {
    for (const leg of travelLegsFor(day.items)) {
      legsByRow.set(`${day.day}:${leg.fromIndex}`, leg);
    }
  }

  return (
    <div>
      {/* The cover carries the stamps, so the page opens on the place, the
          dates and the two verdicts rather than on a paragraph. */}
      <TripCover
        destinations={destinations}
        startDate={startDate}
        endDate={endDate}
        dayCount={result.days?.length ?? 0}
        t={t}
        language={language}
      >
        {result.budget_feasibility && (
          <Stamp ok={result.budget_feasibility.feasible}>
            {result.budget_feasibility.feasible ? t.result.budgetFeasible : t.result.budgetNotFeasible}
          </Stamp>
        )}
        {trustScore.totalCount > 0 && (
          <Stamp ok color={trustScoreColor(trustScore.percent)}>
            {trustScore.percent}% {t.result.trustScoreLabel}
          </Stamp>
        )}
      </TripCover>

      <h2
        className="font-display"
        style={{
          fontWeight: 600,
          fontSize: 22,
          lineHeight: 1.4,
          margin: "0 0 20px",
          color: "var(--brand-teal)",
        }}
      >
        {result.trip_summary}
      </h2>

      {result.days && result.days.length > 0 && (
        <button
          type="button"
          onClick={() => downloadItineraryIcs(result, jobId)}
          className="font-ui"
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

      {/* Whether this trip opens without a signal, read from the actual
          cache rather than inferred from the service worker existing -
          see OfflineReady. Beside the calendar export on purpose: both
          answer "will I still have this when I need it". */}
      <OfflineReady jobId={jobId} t={t} />

      {result.budget_feasibility && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
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
            {/* The figure is typed as a required number, but the type
                describes the model's contract, not what actually arrived -
                an absent or non-numeric value reached formatMoney and
                rendered "€NaN" next to the words "minimum estimate", which
                is worse than showing nothing. Number-checked here rather
                than inside formatMoney because a caller with no figure
                should omit the line, not print a zero. */}
            {Number.isFinite(result.budget_feasibility.min_realistic_total_eur) && (
              <div style={{ color: "var(--ink-soft)", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                {t.result.minEstimate}: {formatMoney(result.budget_feasibility.min_realistic_total_eur, currency, rates)}
              </div>
            )}
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
        <WeatherStrip destinations={destinations} startDate={startDate} endDate={endDate} t={t} language={language} />
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
                className="font-ui"
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
              <span className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {day.date}
              </span>
              {day.feasibility_flag && (
                <span className="font-ui" style={{ fontSize: 11, color: "var(--unverified)" }}>
                  ⚠ {day.feasibility_flag}
                </span>
              )}
            </div>
            {/* One real photo of somewhere the day actually goes, before
                the list. See DayPhoto: capped at one per day because this
                is the only element on the page billed per view. */}
            {/* `?? []` on a field the schema marks required, deliberately.
                `days`, `key_decisions` and `things_to_skip` are all guarded
                here and `items` was not, so one day arriving without it
                threw during render and blanked a finished, paid-for trip -
                the same shape as the budget `reasoning` defect. The worker
                now rejects that response and retries (see
                assertUsableItinerary), which is the real fix; this is the
                backstop for a trip already sitting in Redis from before
                that check existed, where there is nothing left to retry. */}
            <DayPhoto items={day.items ?? []} />

            {(day.items ?? []).map((item, i) => {
              const key = itemKey(day.day, i, item);
              const expanded = expandedItems.has(key);
              // The leg that STARTS at this row, so it renders underneath
              // it and above the next stop. Keyed by fromIndex because
              // legs skip over unplaced items - an unverified stop between
              // two museums must not break the chain, or the day quietly
              // loses the leg that matters most.
              const leg = legsByRow.get(`${day.day}:${i}`);
              return (
                <Fragment key={key}>
                <div
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
                    <ConfidenceTag
                      tier={item.confidence_tier ?? "inferred"}
                      label={t.tierTag[item.confidence_tier ?? "inferred"]}
                    />
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</span>
                      <span className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                        {item.flight_search_url && item.cost_estimate_eur > 0 && item.source_confidence !== "grounded" ? (
                          // A flight's own guessed fare has repeatedly turned out badly wrong
                          // in practice (a model estimate is not a live price check) - rather
                          // than show a number that might flatly contradict the real, current
                          // price one tap away, point straight at the real price instead of
                          // asserting our own. Only applies when NOT grounded - applyFlightPricing
                          // (worker/src/engine/flightPricing.ts) replaces this guess with a real,
                          // live-checked fare and marks it "grounded" when it succeeds, in which
                          // case the real number is shown below like any other grounded price.
                          <a
                            href={safeHref(item.flight_search_url ?? "") ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--grounded)", textDecoration: "underline" }}
                          >
                            {t.result.checkFlightPrices} ↗
                          </a>
                        ) : item.cost_estimate_eur === 0 ? (
                          t.result.free
                        ) : (
                          `${formatMoney(item.cost_estimate_eur, currency, rates)}${
                            t.result.inlineTierLabel[item.confidence_tier ?? "inferred"]
                              ? ` (${t.result.inlineTierLabel[item.confidence_tier ?? "inferred"]})`
                              : ""
                          }`
                        )}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                      {item.location} · {item.time}
                    </div>
                    {/* Where this live-checked fare sits against the route's
                        own price history. Stated as a fact about a range
                        that actually happened, never as a prediction - the
                        band is always shown alongside the verdict so the
                        claim is checkable rather than asserted. */}
                    {item.fare_price_context && (
                      <div
                        className="font-ui"
                        style={{
                          fontSize: 11,
                          marginTop: 4,
                          color:
                            item.fare_price_context.level === "low"
                              ? "var(--grounded)"
                              : item.fare_price_context.level === "high"
                                ? "var(--unverified)"
                                : "var(--ink-dim)",
                        }}
                      >
                        {t.result.farePrice[item.fare_price_context.level]}{" "}
                        <span style={{ color: "var(--ink-dim)" }}>
                          {t.result.farePriceRange
                            .replace("{low}", formatMoney(item.fare_price_context.typicalLowEur, currency, rates))
                            .replace("{high}", formatMoney(item.fare_price_context.typicalHighEur, currency, rates))}
                        </span>
                      </div>
                    )}
                    {item.google_business_status && item.google_business_status !== "operational" ? (
                      <div className="font-ui" style={{ fontSize: 11, color: "var(--infeasible)", marginTop: 4 }}>
                        ⚠{" "}
                        {item.google_business_status === "closed_permanently"
                          ? t.result.closedPermanently
                          : t.result.closedTemporarily}
                      </div>
                    ) : (
                      item.google_rating != null && (
                        <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                          ★ {item.google_rating.toFixed(1)}
                          {item.google_rating_count != null &&
                            ` (${t.result.googleRatingCount.replace("{count}", String(item.google_rating_count))})`}
                          {item.google_price_level && item.google_price_level !== "free" && (
                            <> · {PRICE_LEVEL_SYMBOL[item.google_price_level]}</>
                          )}
                        </div>
                      )
                    )}
                    {/* The hours for the day this item is actually on. Every
                        other signal here is about whether a place is worth
                        going to; this is the only one about whether going
                        is possible, so it earns its own line rather than
                        being folded into the rating. Anything Google says
                        is shut at that hour was already removed upstream
                        (see checkVenues), which is exactly why showing the
                        hours matters: it's the visible half of a promise
                        the traveler otherwise has to take on trust. */}
                    {item.google_open_on_visit === true && item.google_opening_hours && (
                      <div className="font-ui" style={{ fontSize: 11, color: "var(--grounded)", marginTop: 4 }}>
                        {t.result.openOnThisDay}
                        {(() => {
                          const hours = hoursLineFor(item.google_opening_hours, day.date);
                          if (!hours) return null;
                          return <span style={{ color: "var(--ink-dim)" }}> · {hours}</span>;
                        })()}
                      </div>
                    )}
                    {safeHref(item.google_maps_url ?? "") && item.google_business_status !== "closed_permanently" && (
                      <a
                        href={safeHref(item.google_maps_url ?? "") ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-ui"
                        style={{ fontSize: 11, color: "var(--grounded)", textDecoration: "underline", marginTop: 4, display: "inline-block" }}
                      >
                        {t.result.viewOnGoogleMaps} ↗
                      </a>
                    )}
                    {/* Non-grounded, non-zero-cost flight items already fold this same link
                        into the price slot above instead of showing a guessed figure. This
                        separate line covers the other two cases: the free/already-covered
                        return leg (still deserves a real link even with no price to
                        second-guess), and a grounded, live-checked fare (the real number is
                        shown above, but the link is still worth keeping for a second look). */}
                    {safeHref(item.flight_search_url ?? "") && (item.cost_estimate_eur === 0 || item.source_confidence === "grounded") && (
                      <a
                        href={safeHref(item.flight_search_url ?? "") ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-ui"
                        style={{ fontSize: 11, color: "var(--grounded)", textDecoration: "underline", marginTop: 4, display: "inline-block" }}
                      >
                        {t.result.checkFlightPrices} ↗
                      </a>
                    )}
                    <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink-soft)" }}>{item.reasoning}</div>
                    <button
                      type="button"
                      onClick={() => toggleEvidence(key)}
                      className="font-ui"
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
                {leg && <TravelLegRow leg={leg} t={t} />}
                </Fragment>
              );
            })}

            {/* The day as a shape, after the list rather than before it:
                the plot answers "how spread out is this?", which is a
                question you have once you have read what the day contains.
                Renders nothing when fewer than two stops carry
                coordinates. */}
            <DayMap items={day.items ?? []} t={t} />
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
            className="font-ui btn-primary"
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
          <div className="font-ui" style={{ marginTop: 8, fontSize: 12, color: "var(--ink-dim)" }}>
            {refiningLabel}
          </div>
        )}
        {refineError && (
          <div className="font-ui" style={{ marginTop: 8, fontSize: 12, color: "var(--infeasible)" }}>
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
                className="font-ui"
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

      {/* Last thing on the page, and only once the trip is actually over -
          see TripVisitedPrompt. This is the one moment someone is certain
          to be thinking about this specific trip, which is exactly when
          "add it to your map" is worth asking. */}
      <TripVisitedPrompt destinations={destinations} endDate={endDate} t={t} language={language} />
    </div>
  );
}
