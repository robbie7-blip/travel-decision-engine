// Ported from engine.py — same system prompt, same grounding/retrieval approach,
// same output schema. Unlike the earlier web-demo.jsx browser prototype, this
// keeps the full schema (no 2-day cap, no compact array format) since a
// server-side call has a proper token budget to work with.

import fs from "node:fs";
import path from "node:path";
// Relative, not "@/lib/types" — also imported directly by the worker.
import type { Itinerary, TripBriefInput } from "../types";

// Overridable so the worker (running from a different cwd than the Next.js
// app) can point this at the same facts/ directory without duplicating it.
const FACTS_DIR = process.env.FACTS_DIR ?? path.join(process.cwd(), "facts");

export const SYSTEM_PROMPT = `You are a travel decision engine. Your job is not to list options — \
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
- If a "Traveling from" origin is given, include a real first-day arrival transport item and \
a last-day departure transport item (e.g. train/flight, with a hedged cost estimate) instead \
of treating that leg as unspecified or excluding it from the budget. If no origin is given, \
it's fine to note that inter-city arrival/departure cost is unspecified.
- Treat "must-see/must-do" items as near-mandatory inclusions — work them into the itinerary \
explicitly. If one is genuinely infeasible given the pace, dates, or budget, do not silently \
drop it: say so explicitly in trip_summary and in a key_decisions entry, the same way you \
would flag a hard_no conflict.
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
- LODGING LINE ITEMS: include exactly one "lodging" item for EACH night of the stay, \
even if it's the same place every night (do not collapse a multi-night stay into a \
single check-in item). Each lodging item's cost_estimate_eur is that ONE night's cost, \
not a multi-night total — the sum across nights must match your budget_feasibility math.
- Output ONLY valid JSON matching the schema below. No prose outside the JSON. \
No trailing commas after the last property in an object or the last item in an array.
- WRITING STYLE: write like a person texting a friend, not like an AI assistant. Never use \
an em dash ("—"). If you need a break in a sentence, use a comma, a period, or a short hyphen \
("-") instead. Keep sentences short and plain.

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
          "source_confidence": "grounded|inferred",
          "source_urls": ["0-2 exact URLs used to ground this — 2 if cross-checked, 1 if single-source, [] if none"],
          "source_agreement": "agree|disagree|null — only set when two cross-check searches were performed"
        }
      ],
      "feasibility_flag": null
    }
  ],
  "things_to_skip": [
    {"item": "...", "reasoning": "..."}
  ]
}`;

interface Fact {
  category: string;
  text: string;
}

/** Retrieval layer, v0: exact-filename lookup against a curated JSON file.
 * Deliberately dumb — fine for 5-10 cities. Mirrors engine.py's load_facts. */
export function loadFacts(city: string): Fact[] {
  const filename = `${city.toLowerCase().replace(/ /g, "_")}.json`;
  const filePath = path.join(FACTS_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return data.facts ?? [];
}

const LANGUAGE_LABEL: Record<TripBriefInput["language"], string> = {
  en: "English",
  bg: "Bulgarian (български)",
};

function tripBriefToPromptBlock(brief: TripBriefInput): string {
  const lines = [
    `Response language: ${LANGUAGE_LABEL[brief.language]} — write every natural-language ` +
      `field (trip_summary, key_decisions decision/reasoning/alternative_considered, item ` +
      `reasoning, feasibility_flag, things_to_skip reasoning) in this language. Keep JSON ` +
      `keys and the schema structure exactly as specified; proper nouns (place/venue names) ` +
      `may stay in their common form.`,
    `Destinations: ${brief.destinations.join(", ")}`,
    `Dates: ${brief.start_date} to ${brief.end_date}`,
    `Travelers: ${brief.party_size} (${brief.party_composition})`,
    `Budget: ${brief.budget_total_eur != null ? `€${brief.budget_total_eur} total` : "not specified — assume mid-range"}`,
    `Pace: ${brief.pace}`,
    `Interests: ${brief.interests.length ? brief.interests.join(", ") : "general sightseeing"}`,
  ];
  if (brief.origin?.trim()) {
    lines.push(`Traveling from: ${brief.origin.trim()}`);
  }
  if (brief.must_see.length) {
    lines.push(`Must-see/must-do (near-mandatory inclusions): ${brief.must_see.join(", ")}`);
  }
  if (brief.dietary_constraints.length) {
    lines.push(`Dietary constraints: ${brief.dietary_constraints.join(", ")}`);
  }
  if (brief.mobility_constraints.length) {
    lines.push(`Mobility constraints: ${brief.mobility_constraints.join(", ")}`);
  }
  if (brief.hard_no.length) {
    lines.push(`Hard constraints (must not violate): ${brief.hard_no.join(", ")}`);
  }
  return lines.join("\n");
}

function buildContext(brief: TripBriefInput): { tripBlock: string; factsBlock: string; warning: string } {
  const factsBlocks: string[] = [];
  let anyUngrounded = false;

  for (const city of brief.destinations) {
    const facts = loadFacts(city);
    if (facts.length) {
      const factsStr = facts.map((f) => `- [${f.category}] ${f.text}`).join("\n");
      factsBlocks.push(`Facts for ${city}:\n${factsStr}`);
    } else {
      anyUngrounded = true;
      factsBlocks.push(
        `Facts for ${city}: NONE AVAILABLE. You have no verified data for this ` +
          `city. Do not state specific prices, hours, or logistics with confidence. ` +
          `Every reasoning string touching ${city} must contain an explicit hedge word ` +
          `('unverified', 'unconfirmed', 'I don't have checked data on this') — write ` +
          `as a knowledgeable friend would if honestly saying 'I'm not sure, but...' ` +
          `rather than as a confident local guide.`
      );
    }
  }

  const warning = anyUngrounded
    ? "\nIMPORTANT: at least one destination has no grounding data. Your " +
      "trip_summary must explicitly state that pricing/logistics for that city " +
      "are unverified estimates, not confirmed facts.\n"
    : "";

  return { tripBlock: tripBriefToPromptBlock(brief), factsBlock: factsBlocks.join("\n"), warning };
}

export function buildPrompt(brief: TripBriefInput): string {
  const { tripBlock, factsBlock, warning } = buildContext(brief);

  return `Trip brief:
${tripBlock}

${factsBlock}
${warning}
Generate the itinerary now, as JSON matching the schema in your instructions.`;
}

/** Builds the prompt for a pushback/follow-up request: same trip-brief and
 * facts context as a fresh generation, plus the itinerary already shown to
 * the traveler and their question about it. Asks the model to answer
 * directly (pushback_response) and only touch what the pushback actually
 * warrants, rather than regenerating the whole trip from scratch. */
export function buildRefinementPrompt(brief: TripBriefInput, baseItinerary: Itinerary, question: string): string {
  const { tripBlock, factsBlock, warning } = buildContext(brief);

  return `Trip brief:
${tripBlock}

${factsBlock}
${warning}
This is a FOLLOW-UP refinement request, not a fresh itinerary. Here is the itinerary you \
previously generated for this exact trip brief:
${JSON.stringify(baseItinerary)}

The traveler has this pushback/follow-up question about it:
"${question}"

Your job:
1. Set "pushback_response" to a direct, one-paragraph answer to their question, in the response \
language specified above. If they're right, say so and explain what you're changing. If they're \
wrong, or the request conflicts with a hard constraint or the budget, say so plainly and explain \
why — the same way an opinionated local friend who disagrees with you would. Do not silently \
comply just to please them, and do not silently ignore the question either.
2. Then output the full itinerary again, as JSON matching the exact schema you were given \
originally, with any changes applied (or unchanged, if no change is warranted). Only touch what \
this pushback actually affects — leave every other item (including its cost, reasoning, \
source_urls, and confidence signals) exactly as it was. Do not re-run searches for things you \
aren't changing.
3. Still enforce all the same rules as before: budget integrity, one lodging item per night, \
grounding discipline, hedge language for unverified data.

Output ONLY valid JSON matching the schema, now including a top-level "pushback_response" string \
field alongside the existing fields. No prose outside the JSON.`;
}
