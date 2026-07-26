"""
Phase 0 Decision Engine.

This is the whole bet of the product, in its smallest testable form:
TripBrief -> grounded facts -> reasoned itinerary with explicit decisions.

Run this against 10-15 realistic briefs and read every output carefully
before writing a single line of frontend code. If the reasoning isn't
good enough to trust, nothing built on top of it will save the product.

SETUP:
  pip install anthropic
  export ANTHROPIC_API_KEY=your_key_here

USAGE:
  python engine.py                  # runs the sample briefs in trip_brief.py
"""

import json
import os
import time
from pathlib import Path

from trip_brief import TripBrief, SAMPLE_BRIEFS, ADVERSARIAL_BRIEFS

FACTS_DIR = Path(__file__).parent / "facts"

SYSTEM_PROMPT = """You are a travel decision engine. Your job is not to list options — \
it is to DECIDE and justify. For every meaningful choice (which city to prioritize, \
which day to visit which sight, whether to take a train or skip a stop, where to \
eat), state the decision AND the one-line reason behind it, the same way a smart, \
opinionated local friend would.

Rules:
- Ground every factual claim (price, distance, timing) in the provided facts. \
If a fact isn't in the provided context, hedge explicitly ("roughly", "typically") \
rather than inventing a precise number.
- Surface tradeoffs, not just plans. If skipping something is the better call, say so \
and say why.
- Respect all hard constraints exactly (dietary, mobility, budget ceiling, "hard_no" items).
- Flag anything that looks logistically tight or infeasible (e.g. too much travel \
crammed into one day) rather than silently including it.
- If any preferences are in direct tension with each other (e.g. a fast pace combined \
with mandatory long rest periods, or a long interest list combined with a short trip), \
say so explicitly in trip_summary and in a key_decisions entry — do not just silently \
comply with the literal wording of each constraint while ignoring that they conflict.
- BUDGET FEASIBILITY CHECK IS MANDATORY AND MUST BE CONSISTENT: before generating the \
itinerary, independently estimate a realistic MINIMUM total cost for this trip — \
including lodging for every night, even if you have no verified lodging data (use \
general knowledge and hedge it explicitly, e.g. "a bare-minimum hostel is realistically \
at least roughly €X/night, unverified"). Compare that minimum to the stated budget. \
You MUST include a "budget_feasibility" object as specified below, and you MUST NOT \
silently reduce or omit a major cost category (especially lodging) just to make the \
numbers appear to fit — if lodging is excluded from the daily items, budget_feasibility \
must say so explicitly and explain why the budget is infeasible as stated.
- Output ONLY valid JSON matching the schema below. No prose outside the JSON.

Schema:
{
  "budget_feasibility": {
    "feasible": true or false,
    "min_realistic_total_eur": 0,
    "reasoning": "explain your minimum estimate and whether/why the stated budget is or isn't realistic, noting explicitly if any cost category (e.g. lodging) had to be excluded or reduced to fit"
  },
  "trip_summary": "one sentence — MUST mention if budget is infeasible or data is unverified",
  "key_decisions": [
    {"decision": "...", "reasoning": "...", "alternative_considered": "...", "confidence": "high|medium|low"}
  ],
  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "items": [
        {
          "time": "morning|afternoon|evening or HH:MM",
          "type": "transport|lodging|activity|meal",
          "title": "...",
          "location": "...",
          "cost_estimate_eur": 0,
          "reasoning": "why this, why now",
          "source_confidence": "grounded|inferred"
        }
      ],
      "feasibility_flag": null
    }
  ],
  "things_to_skip": [
    {"item": "...", "reasoning": "..."}
  ]
}
"""


def load_facts(city: str) -> list[dict]:
    """Retrieval layer, v0: exact-filename lookup against a curated JSON file.
    Deliberately dumb — this is fine for 5-10 cities. Replace with embeddings-based
    retrieval only once city coverage makes keyword/exact lookup break down.
    """
    path = FACTS_DIR / f"{city.lower().replace(' ', '_')}.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return data.get("facts", [])


def build_prompt(brief: TripBrief) -> str:
    facts_blocks = []
    any_ungrounded = False
    for city in brief.destinations:
        facts = load_facts(city)
        if facts:
            facts_str = "\n".join(f"- [{f['category']}] {f['text']}" for f in facts)
            facts_blocks.append(f"Facts for {city}:\n{facts_str}")
        else:
            any_ungrounded = True
            facts_blocks.append(
                f"Facts for {city}: NONE AVAILABLE. You have no verified data for this "
                f"city. Do not state specific prices, hours, or logistics with confidence. "
                f"Every reasoning string touching {city} must contain an explicit hedge word "
                f"('unverified', 'unconfirmed', 'I don't have checked data on this') — write "
                f"as a knowledgeable friend would if honestly saying 'I'm not sure, but...' "
                f"rather than as a confident local guide."
            )

    warning = ""
    if any_ungrounded:
        warning = (
            "\nIMPORTANT: at least one destination has no grounding data. Your "
            "trip_summary must explicitly state that pricing/logistics for that city "
            "are unverified estimates, not confirmed facts.\n"
        )

    return f"""Trip brief:
{brief.to_prompt_block()}

{chr(10).join(facts_blocks)}
{warning}
Generate the itinerary now, as JSON matching the schema in your instructions."""


def generate_itinerary(
    brief: TripBrief,
    model: str = "claude-sonnet-4-5-20250929",
    retries: int = 3,
    max_tokens: int = 8000,
) -> dict:
    try:
        import anthropic
    except ImportError:
        raise SystemExit("Run: pip install anthropic")

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": build_prompt(brief)}],
            )
            break
        except anthropic.APIConnectionError as e:
            last_error = e
            print(f"  (network hiccup, retry {attempt}/{retries}...)")
            time.sleep(2 * attempt)  # simple backoff: 2s, 4s, 6s
    else:
        raise last_error

    text = "".join(block.text for block in response.content if block.type == "text")
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Model did not return valid JSON: {e}\n\nRaw output:\n{text}")


def check_feasibility(itinerary: dict) -> dict:
    """Minimal rule-based sanity check layer, run on top of the LLM output.
    This is what makes the product trustworthy rather than just plausible-sounding —
    catch the model overpacking a day even if its prose sounds confident.
    Expand this over time (real travel-time lookups, opening-hours checks, etc.)
    """
    for day in itinerary.get("days", []):
        activity_items = [i for i in day["items"] if i["type"] in ("activity", "meal")]
        if len(activity_items) > 5:
            day["feasibility_flag"] = (
                f"{len(activity_items)} activities/meals scheduled in one day — "
                f"likely overpacked, review pacing."
            )
    return itinerary


def check_budget_integrity(itinerary: dict, brief: TripBrief) -> dict:
    """Cross-check the model's self-reported budget_feasibility against what's
    actually in the itinerary. This exists because the model was observed to be
    INCONSISTENT across runs — sometimes explicitly flagging an impossible budget,
    sometimes quietly omitting lodging costs to make the numbers appear to fit.
    Don't trust the self-report alone; verify it structurally.
    """
    nights = 0
    if brief.start_date and brief.end_date:
        from datetime import date
        d1 = date.fromisoformat(brief.start_date)
        d2 = date.fromisoformat(brief.end_date)
        nights = max((d2 - d1).days, 0)

    lodging_items = [
        item for day in itinerary.get("days", []) for item in day["items"]
        if item.get("type") == "lodging"
    ]

    warnings = []
    if nights > 0 and not lodging_items:
        warnings.append(
            f"Itinerary spans {nights} night(s) but has NO lodging line items at all — "
            f"the budget total is almost certainly missing a major cost, regardless "
            f"of what budget_feasibility below claims."
        )
    elif nights > 0 and lodging_items and len(lodging_items) < nights:
        warnings.append(
            f"Itinerary spans {nights} nights but only {len(lodging_items)} lodging "
            f"line item(s) appear — likely undercounting total lodging cost."
        )

    self_report = itinerary.get("budget_feasibility", {})
    if self_report.get("feasible") is True and warnings:
        warnings.append(
            "MISMATCH: model self-reported budget as FEASIBLE, but the itinerary "
            "structurally excludes a full lodging cost. Treat 'feasible: true' with "
            "suspicion — this is the exact inconsistency this check exists to catch."
        )

    itinerary["_budget_integrity_warnings"] = warnings
    return itinerary

def pretty_print(itinerary: dict) -> None:
    bf = itinerary.get("budget_feasibility", {})
    if bf:
        status = "FEASIBLE" if bf.get("feasible") else "NOT FEASIBLE AS STATED"
        print(f"\nBUDGET FEASIBILITY (model self-report): {status}")
        print(f"  Model's minimum realistic estimate: €{bf.get('min_realistic_total_eur', '?')}")
        print(f"  {bf.get('reasoning', '')}")

    integrity_warnings = itinerary.get("_budget_integrity_warnings", [])
    if integrity_warnings:
        print("\n⚠⚠ BUDGET INTEGRITY CHECK (independent of the model's self-report):")
        for w in integrity_warnings:
            print(f"  ⚠ {w}")

    print(f"\n=== {itinerary.get('trip_summary', '')} ===\n")

    print("KEY DECISIONS:")
    for d in itinerary.get("key_decisions", []):
        print(f"  • {d['decision']}  [{d['confidence']}]")
        print(f"      why: {d['reasoning']}")
        if d.get("alternative_considered"):
            print(f"      (vs: {d['alternative_considered']})")

    print("\nITINERARY:")
    for day in itinerary.get("days", []):
        flag = f"  ⚠ {day['feasibility_flag']}" if day.get("feasibility_flag") else ""
        print(f"\n  Day {day['day']} ({day.get('date', '')}){flag}")
        for item in day["items"]:
            grounded = item.get("source_confidence") == "grounded"
            conf = "✓" if grounded else "~"
            cost_label = (
                f"€{item.get('cost_estimate_eur', '?')}"
                if grounded
                else f"€{item.get('cost_estimate_eur', '?')} [UNVERIFIED ESTIMATE]"
            )
            print(f"    [{item['time']}] {conf} {item['title']} — {item['location']} ({cost_label})")
            print(f"        {item['reasoning']}")

    if itinerary.get("things_to_skip"):
        print("\nSKIP THIS:")
        for s in itinerary["things_to_skip"]:
            print(f"  ✗ {s['item']}: {s['reasoning']}")

    # Budget honesty summary — the whole point of this block is to stop
    # a confident-sounding itinerary from hiding how much of its cost
    # estimate is actually made up.
    verified_total, unverified_total = 0, 0
    for day in itinerary.get("days", []):
        for item in day["items"]:
            cost = item.get("cost_estimate_eur") or 0
            if item.get("source_confidence") == "grounded":
                verified_total += cost
            else:
                unverified_total += cost
    grand_total = verified_total + unverified_total
    pct_unverified = (unverified_total / grand_total * 100) if grand_total else 0
    print(f"\nBUDGET RELIABILITY: €{grand_total} total estimated "
          f"(€{verified_total} grounded in facts, €{unverified_total} unverified estimate "
          f"— {pct_unverified:.0f}% of the total is a guess, not a checked number)")


def run_briefs(briefs: list[TripBrief], label: str) -> None:
    for brief in briefs:
        print(f"\n{'='*70}\n[{label}] Generating for: {', '.join(brief.destinations)}\n{'='*70}")
        itinerary = generate_itinerary(brief)
        itinerary = check_feasibility(itinerary)
        itinerary = check_budget_integrity(itinerary, brief)
        pretty_print(itinerary)

        out_dir = Path(__file__).parent / "outputs"
        out_dir.mkdir(exist_ok=True)
        fname = f"{label}_" + "_".join(brief.destinations).lower().replace(" ", "_") + ".json"
        (out_dir / fname).write_text(json.dumps(itinerary, indent=2))


if __name__ == "__main__":
    import sys

    mode = sys.argv[1] if len(sys.argv) > 1 else "sample"
    if mode == "adversarial":
        run_briefs(ADVERSARIAL_BRIEFS, "adversarial")
    elif mode == "all":
        run_briefs(SAMPLE_BRIEFS, "sample")
        run_briefs(ADVERSARIAL_BRIEFS, "adversarial")
    else:
        run_briefs(SAMPLE_BRIEFS, "sample")
