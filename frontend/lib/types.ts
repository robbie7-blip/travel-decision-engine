// Mirrors trip_brief.TripBrief (backend/../trip_brief.py) — the input contract.
export interface TripBriefInput {
  destinations: string[];
  // Departure city/location, optional — lets the engine estimate a real
  // arrival/departure transport cost instead of excluding it as unspecified
  // (previously observed leaving it out of the itinerary entirely).
  origin?: string;
  start_date: string;
  end_date: string;
  party_size: number;
  party_composition: string;
  budget_total_eur: number | null;
  pace: "relaxed" | "moderate" | "packed";
  interests: string[];
  // Specific non-negotiable inclusions (distinct from the broader `interests`
  // categories) — treated with the same seriousness as hard_no, but as
  // musts rather than avoids.
  must_see: string[];
  dietary_constraints: string[];
  mobility_constraints: string[];
  hard_no: string[];
}

// Mirrors the JSON schema in engine.py's SYSTEM_PROMPT — the output contract.
export interface BudgetFeasibility {
  feasible: boolean;
  min_realistic_total_eur: number;
  reasoning: string;
}

export interface KeyDecision {
  decision: string;
  reasoning: string;
  alternative_considered?: string;
  confidence: "high" | "medium" | "low";
}

export type ItemType = "transport" | "lodging" | "activity" | "meal";
export type SourceConfidence = "grounded" | "inferred";
export type SourceAgreement = "agree" | "disagree";

export interface ItineraryItem {
  time: string;
  type: ItemType;
  title: string;
  location: string;
  cost_estimate_eur: number;
  reasoning: string;
  source_confidence: SourceConfidence;
  // Populated by the worker when live web search backs this item (see
  // SEARCH_INSTRUCTIONS in worker/src/index.ts) — the model writes the real
  // URL(s) it used directly into this field. Deliberately not relying on the
  // Anthropic API's automatic citation feature: that splits prose into
  // multiple text blocks around each citation, which would fragment our
  // forced-JSON output. 0-2 entries: 2 when the model cross-checked two
  // independent searches, 1 for a single usable result, absent/empty otherwise.
  source_urls?: string[];
  // Set only when two cross-check searches produced meaningfully conflicting
  // price info — the reasoning text explains the discrepancy explicitly
  // rather than silently picking one number. Null/absent for single-source
  // or ungrounded items.
  source_agreement?: SourceAgreement | null;
  // Derived by checkBudgetIntegrity's confidence-tier pass (worker/src/engine/
  // checks.ts) from source_urls/source_agreement above — NOT self-reported by
  // the model, on the same "verify structurally, don't trust the self-report"
  // principle as the budget-integrity check itself.
  confidence_tier?: ConfidenceTier;
}

// "fact_grounded" is for items grounded in the curated facts/*.json base
// (source_confidence: "grounded", no live search — most non-lodging items)
// — distinct from the live-search tiers below, and NOT the same as
// "inferred": it's still checked data, just not cross-checked via search.
export type ConfidenceTier =
  | "verified"
  | "fact_grounded"
  | "single_source"
  | "conflicting"
  | "inferred";

export interface ItineraryDay {
  day: number;
  date: string;
  items: ItineraryItem[];
  feasibility_flag: string | null;
}

export interface SkipItem {
  item: string;
  reasoning: string;
}

export interface Itinerary {
  budget_feasibility: BudgetFeasibility;
  trip_summary: string;
  key_decisions: KeyDecision[];
  days: ItineraryDay[];
  things_to_skip: SkipItem[];
  _budget_integrity_warnings?: string[];
}
