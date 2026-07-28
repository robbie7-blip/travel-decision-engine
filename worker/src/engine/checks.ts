// Ported from engine.py's check_feasibility / check_budget_integrity.
// These are the rule-based sanity checks that run on top of the LLM output —
// what makes the product trustworthy rather than just plausible-sounding.

// Relative, not "@/lib/types" — this file is also imported directly by the
// worker (a separate Node project outside the Next.js app), which doesn't
// have the Next.js path-alias resolution configured.
import type { Itinerary, TripBriefInput } from "../types";

/** Flags days with more than 5 activity/meal items as likely overpacked. */
export function checkFeasibility(itinerary: Itinerary): Itinerary {
  for (const day of itinerary.days ?? []) {
    const activityItems = day.items.filter((i) => i.type === "activity" || i.type === "meal");
    if (activityItems.length > 5) {
      day.feasibility_flag = `${activityItems.length} activities/meals scheduled in one day — likely overpacked, review pacing.`;
    }
  }
  return itinerary;
}

/** Cross-checks the model's self-reported budget_feasibility against what's
 * actually in the itinerary. The model has been observed to be INCONSISTENT
 * across runs — sometimes flagging an impossible budget, sometimes quietly
 * omitting lodging costs to make the numbers appear to fit. Don't trust the
 * self-report alone; verify it structurally. */
export function checkBudgetIntegrity(itinerary: Itinerary, brief: TripBriefInput): Itinerary {
  let nights = 0;
  if (brief.start_date && brief.end_date) {
    const d1 = new Date(brief.start_date);
    const d2 = new Date(brief.end_date);
    nights = Math.max(Math.round((d2.getTime() - d1.getTime()) / 86_400_000), 0);
  }

  const lodgingItems = (itinerary.days ?? []).flatMap((day) =>
    day.items.filter((item) => item.type === "lodging")
  );

  const warnings: string[] = [];
  if (brief.needs_lodging && nights > 0 && lodgingItems.length === 0) {
    warnings.push(
      `Itinerary spans ${nights} night(s) but has NO lodging line items at all — ` +
        `the budget total is almost certainly missing a major cost, regardless ` +
        `of what budget_feasibility below claims.`
    );
  } else if (nights > 0 && lodgingItems.length > 0 && lodgingItems.length < nights) {
    warnings.push(
      `Itinerary spans ${nights} nights but only ${lodgingItems.length} lodging ` +
        `line item(s) appear — likely undercounting total lodging cost.`
    );
  }

  const selfReport = itinerary.budget_feasibility;
  if (selfReport?.feasible === true && warnings.length > 0) {
    warnings.push(
      "MISMATCH: model self-reported budget as FEASIBLE, but the itinerary " +
        "structurally excludes a full lodging cost. Treat 'feasible: true' with " +
        "suspicion — this is the exact inconsistency this check exists to catch."
    );
  }

  itinerary._budget_integrity_warnings = warnings;
  return itinerary;
}

/** Derives each item's confidence_tier from the cross-check signals the
 * model already reported (source_urls, source_agreement) rather than having
 * the model self-report a tier directly — same "verify structurally" reason
 * checkBudgetIntegrity doesn't trust budget_feasibility.feasible on its own. */
export function deriveConfidenceTiers(itinerary: Itinerary): Itinerary {
  for (const day of itinerary.days ?? []) {
    for (const item of day.items) {
      const urlCount = item.source_urls?.length ?? 0;
      if (item.source_confidence !== "grounded") {
        item.confidence_tier = "inferred";
      } else if (urlCount === 0) {
        // Grounded in the curated facts base, not a live search — most
        // non-lodging items. Distinct from "inferred": it's still checked
        // data, just not search-cross-checked.
        item.confidence_tier = "fact_grounded";
      } else if (urlCount >= 2 && item.source_agreement === "disagree") {
        item.confidence_tier = "conflicting";
      } else if (urlCount >= 2 && item.source_agreement === "agree") {
        item.confidence_tier = "verified";
      } else {
        item.confidence_tier = "single_source";
      }
    }
  }
  return itinerary;
}
