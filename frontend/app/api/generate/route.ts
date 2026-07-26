// Next.js API route — the server-side boundary. Calls the Anthropic API using
// ANTHROPIC_API_KEY from the environment; this file runs only on the server,
// so the key is never bundled into or reachable from browser JS.
//
// Reuses engine.py's system prompt, facts grounding, and budget_feasibility /
// check_budget_integrity logic (ported to TypeScript in lib/engine/), minus
// the token-budget workarounds a browser-side prototype would need — full
// schema, no compact array format, no multi-day cap.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildPrompt, SYSTEM_PROMPT } from "@/lib/engine/prompt";
import { checkBudgetIntegrity, checkFeasibility } from "@/lib/engine/checks";
import type { Itinerary, TripBriefInput } from "@/lib/types";

export const runtime = "nodejs";
// Vercel's Hobby plan hard-caps function execution at 60s. claude-opus-5 at
// low effort measured ~53s for this schema — too little margin for a retry
// or normal latency variance. claude-sonnet-5 at low effort measured ~35s
// with comparable reasoning quality, giving real headroom under the cap.
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 12000;
const EFFORT = "low";
const VALID_PACES = new Set(["relaxed", "moderate", "packed"]);

// Experimental, behind a flag: scoped live web search for lodging price
// ranges only (the highest-volatility, highest-budget-impact fact category —
// see check_budget_integrity, which exists specifically because lodging cost
// is what the model gets wrong). Deliberately NOT a general "search
// everything" feature — every additional search adds latency against
// Vercel's 60s cap, so this is a measurement of cost/latency impact before
// deciding whether to expand it, not a production feature yet.
const ENABLE_LODGING_SEARCH = process.env.ENABLE_LODGING_SEARCH === "true";
const LODGING_SEARCH_INSTRUCTIONS = `You have a web_search tool available. Use it ONLY to check \
current typical lodging price ranges (budget and mid-range, per night) for each destination in \
this trip — nothing else. Search at most once per destination. Do not search for restaurants, \
activities, transit, or anything not about lodging pricing.

If a search returns a usable current price range, use it for lodging cost_estimate_eur items and \
mark those items' source_confidence as "grounded" (cite that it's from a current source in the \
reasoning). If search fails or returns nothing specific, fall back to the existing hedged, \
inferred estimate — do not invent a false current source.

After any searches, output ONLY the final JSON matching the schema. Do not write any other text \
before, between, or after — no acknowledgment of the search, no commentary.`;

class ValidationError extends Error {}

function cleanList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array of strings`);
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTripBrief(body: unknown): TripBriefInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  const destinations = cleanList(b.destinations, "destinations");
  if (destinations.length === 0) {
    throw new ValidationError("destinations must include at least one city.");
  }

  if (typeof b.start_date !== "string" || !b.start_date.trim()) {
    throw new ValidationError("start_date is required.");
  }
  if (typeof b.end_date !== "string" || !b.end_date.trim()) {
    throw new ValidationError("end_date is required.");
  }

  const partySize = Number(b.party_size);
  if (!Number.isFinite(partySize) || partySize < 1) {
    throw new ValidationError("party_size must be a number >= 1.");
  }

  if (typeof b.party_composition !== "string" || !b.party_composition.trim()) {
    throw new ValidationError("party_composition is required.");
  }

  let budget: number | null = null;
  if (b.budget_total_eur !== null && b.budget_total_eur !== undefined && b.budget_total_eur !== "") {
    budget = Number(b.budget_total_eur);
    if (!Number.isFinite(budget) || budget < 0) {
      throw new ValidationError("budget_total_eur must be a non-negative number or null.");
    }
  }

  if (typeof b.pace !== "string" || !VALID_PACES.has(b.pace)) {
    throw new ValidationError(`pace must be one of ${[...VALID_PACES].sort().join(", ")}.`);
  }

  return {
    destinations,
    start_date: b.start_date.trim(),
    end_date: b.end_date.trim(),
    party_size: Math.trunc(partySize),
    party_composition: b.party_composition.trim(),
    budget_total_eur: budget,
    pace: b.pace as TripBriefInput["pace"],
    interests: cleanList(b.interests, "interests"),
    dietary_constraints: cleanList(b.dietary_constraints, "dietary_constraints"),
    mobility_constraints: cleanList(b.mobility_constraints, "mobility_constraints"),
    hard_no: cleanList(b.hard_no, "hard_no"),
  };
}

/** Strips a ```json ... ``` fence if the model wrapped its output in one, and
 * removes trailing commas before a closing `}`/`]` — a formatting slip
 * observed occasionally in model output that plain JSON.parse rejects even
 * though it's otherwise well-formed. */
function extractJson(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const parts = t.split("```");
    t = parts[1] ?? t;
    if (t.startsWith("json")) t = t.slice(4);
  }
  t = t.trim().replace(/,(\s*[}\]])/g, "$1");
  return t;
}

class ModelOutputError extends Error {}

async function callModel(client: Anthropic, brief: TripBriefInput): Promise<Itinerary> {
  const system = ENABLE_LODGING_SEARCH
    ? [
        { type: "text" as const, text: SYSTEM_PROMPT },
        { type: "text" as const, text: LODGING_SEARCH_INSTRUCTIONS },
      ]
    : SYSTEM_PROMPT;

  const tools = ENABLE_LODGING_SEARCH
    ? [
        {
          type: "web_search_20260209" as const,
          name: "web_search" as const,
          max_uses: Math.min(brief.destinations.length, 4),
        },
      ]
    : undefined;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    output_config: { effort: EFFORT },
    tools,
    messages: [{ role: "user", content: buildPrompt(brief) }],
  });
  if (ENABLE_LODGING_SEARCH) {
    const searches = response.content.filter((b) => b.type === "server_tool_use").length;
    console.log(
      `[generate] ${Date.now() - start}ms, ${searches} search(es), usage=${JSON.stringify(response.usage)}`
    );
  }

  if (response.stop_reason === "refusal") {
    throw new ModelOutputError(
      "The model declined to generate this itinerary. Try adjusting the request."
    );
  }

  // Take the last text block only, not a join of all of them — with tools
  // enabled the model can interleave short text before/between tool calls,
  // and concatenating those with the final JSON block would corrupt it.
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  const text = textBlocks[textBlocks.length - 1]?.text ?? "";

  const jsonText = extractJson(text);
  try {
    return JSON.parse(jsonText) as Itinerary;
  } catch (e) {
    throw new ModelOutputError(`Model did not return valid JSON: ${(e as Error).message}`);
  }
}

export async function POST(request: NextRequest) {
  let brief: TripBriefInput;
  try {
    const body = await request.json();
    brief = parseTripBrief(body);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ detail: e.message }, { status: 400 });
    }
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { detail: "Server is misconfigured (ANTHROPIC_API_KEY is not set)." },
      { status: 500 }
    );
  }

  const client = new Anthropic({ apiKey });

  let itinerary: Itinerary;
  try {
    try {
      itinerary = await callModel(client, brief);
    } catch (e) {
      if (e instanceof ModelOutputError) {
        // Model occasionally returns truncated/malformed JSON — it's
        // non-deterministic, so one retry usually succeeds.
        itinerary = await callModel(client, brief);
      } else {
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { detail: "Server is misconfigured (invalid API key)." },
        { status: 500 }
      );
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { detail: "Rate limited by the model provider. Try again shortly." },
        { status: 429 }
      );
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return NextResponse.json(
        { detail: "Could not reach the model provider. Try again shortly." },
        { status: 503 }
      );
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ detail: `Model provider error: ${e.message}` }, { status: 502 });
    }
    if (e instanceof ModelOutputError) {
      return NextResponse.json(
        {
          detail:
            "The model's response was malformed twice in a row — try a shorter or simpler trip brief.",
        },
        { status: 502 }
      );
    }
    console.error("Unexpected error generating itinerary", e);
    return NextResponse.json(
      { detail: "Unexpected server error while generating the itinerary." },
      { status: 500 }
    );
  }

  itinerary = checkFeasibility(itinerary);
  itinerary = checkBudgetIntegrity(itinerary, brief);

  return NextResponse.json(itinerary);
}
