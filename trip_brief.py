"""
Structured trip brief schema.

This is the input contract for the Decision Engine. The point of forcing
free-text user input through this schema (rather than passing raw text to
the LLM) is threefold:
  1. It forces the product to ask good questions up front (your "questionnaire"
     concept), rather than hoping the model infers missing constraints.
  2. It gives you something you can log, validate, and debug independently
     of the LLM call.
  3. It's the foundation for the "regenerate with this one change" interaction
     later (Phase 2) - you just mutate one field and re-run.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional
import json


@dataclass
class TripBrief:
    destinations: list[str]              # e.g. ["Brussels", "Bruges"]
    start_date: str                       # ISO format "2026-10-10"
    end_date: str                         # ISO format "2026-10-20"
    party_size: int
    party_composition: str                # e.g. "solo", "couple", "family with 2 kids (8, 11)"
    budget_total_eur: Optional[int]        # None if unknown/flexible
    pace: str                             # "relaxed" | "moderate" | "packed"
    interests: list[str]                  # e.g. ["food", "history", "nature"]
    dietary_constraints: list[str] = field(default_factory=list)   # e.g. ["vegetarian"]
    mobility_constraints: list[str] = field(default_factory=list)  # e.g. ["limited walking"]
    hard_no: list[str] = field(default_factory=list)               # e.g. ["no overnight trains"]

    def to_prompt_block(self) -> str:
        """Render as a compact block for the LLM prompt."""
        lines = [
            f"Destinations: {', '.join(self.destinations)}",
            f"Dates: {self.start_date} to {self.end_date}",
            f"Travelers: {self.party_size} ({self.party_composition})",
            f"Budget: {'€' + str(self.budget_total_eur) + ' total' if self.budget_total_eur else 'not specified - assume mid-range'}",
            f"Pace: {self.pace}",
            f"Interests: {', '.join(self.interests) if self.interests else 'general sightseeing'}",
        ]
        if self.dietary_constraints:
            lines.append(f"Dietary constraints: {', '.join(self.dietary_constraints)}")
        if self.mobility_constraints:
            lines.append(f"Mobility constraints: {', '.join(self.mobility_constraints)}")
        if self.hard_no:
            lines.append(f"Hard constraints (must not violate): {', '.join(self.hard_no)}")
        return "\n".join(lines)

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


# Example briefs for testing the pipeline - replace with real form input later.
SAMPLE_BRIEFS = [
    TripBrief(
        destinations=["Brussels", "Bruges"],
        start_date="2026-10-10",
        end_date="2026-10-13",
        party_size=2,
        party_composition="couple, late 20s",
        budget_total_eur=900,
        pace="moderate",
        interests=["food", "architecture", "beer culture"],
    ),
    TripBrief(
        destinations=["Lisbon"],
        start_date="2026-11-02",
        end_date="2026-11-06",
        party_size=1,
        party_composition="solo",
        budget_total_eur=500,
        pace="relaxed",
        interests=["local food", "coastline", "avoiding tourist traps"],
        dietary_constraints=["vegetarian"],
    ),
]

# --- Adversarial test cases ---
# Purpose: find where the reasoning quality breaks, not confirm it works.
# Run these separately (or add to SAMPLE_BRIEFS) once the happy-path cases
# look solid. A good engine should HEDGE HARD or explicitly flag uncertainty
# on all three of these, rather than confidently making things up.
ADVERSARIAL_BRIEFS = [
    # 1. Zero facts file - nothing in /facts/ for this city. Does it
    #    confidently invent specific prices/hours, or does it visibly hedge?
    TripBrief(
        destinations=["Ljubljana"],
        start_date="2026-09-05",
        end_date="2026-09-08",
        party_size=2,
        party_composition="couple",
        budget_total_eur=600,
        pace="moderate",
        interests=["nature", "local food"],
    ),
    # 2. Genuinely unworkable budget - forces the engine to either say so
    #    honestly or paper over an impossible trip with vague optimism.
    TripBrief(
        destinations=["Brussels", "Bruges"],
        start_date="2026-10-10",
        end_date="2026-10-13",
        party_size=2,
        party_composition="couple",
        budget_total_eur=120,  # unrealistic for 4 days / 2 people in this brief
        pace="moderate",
        interests=["food", "architecture", "beer culture"],
    ),
    # 3. Directly contradictory preferences - "packed" pace with a huge
    #    interest list but explicit no-early-mornings / lots-of-rest
    #    constraint. Tests whether it flags the contradiction or just
    #    quietly picks one side and hopes you don't notice.
    TripBrief(
        destinations=["Lisbon"],
        start_date="2026-11-02",
        end_date="2026-11-04",
        party_size=1,
        party_composition="solo",
        budget_total_eur=500,
        pace="packed",
        interests=["local food", "coastline", "history", "nightlife", "museums", "hiking"],
        hard_no=["no activities before 11am", "at least 3 hours of rest each afternoon"],
    ),
]
