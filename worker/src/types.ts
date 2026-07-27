// Mirrors trip_brief.TripBrief (backend/../trip_brief.py) — the input contract.
export interface TripBriefInput {
  destinations: string[];
  start_date: string;
  end_date: string;
  party_size: number;
  party_composition: string;
  budget_total_eur: number | null;
  pace: "relaxed" | "moderate" | "packed";
  interests: string[];
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

export interface ItineraryItem {
  time: string;
  type: ItemType;
  title: string;
  location: string;
  cost_estimate_eur: number;
  reasoning: string;
  source_confidence: SourceConfidence;
}

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
