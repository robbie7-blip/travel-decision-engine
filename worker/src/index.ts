// Long-running worker: consumes jobs pushed onto jobs:queue by the Next.js
// app's POST /api/generate, calls Claude (with full web search — no
// duration limit here, unlike the old Vercel-serverless version of this
// call), and writes the result back to Redis for the app's poll endpoint
// to read. Deploy this as an always-on process (Railway, Fly.io, etc.),
// not a serverless function.

import "./env"; // must run before the engine import below reads FACTS_DIR

import Anthropic from "@anthropic-ai/sdk";
import type Redis from "ioredis";
import { getRedis } from "./redis";
// Local copies of the shared engine/job code, not "../../frontend/..." —
// Railway's "Root Directory: worker" setting deploys only this directory,
// so a cross-directory import into frontend/ has nothing to resolve
// against in production (works locally where the full repo is checked
// out, breaks in the deployed container). Mirrors the existing
// facts/ vs frontend/facts/ duplication already in this repo.
import { buildPrompt, buildRefinementPrompt, SYSTEM_PROMPT } from "./engine/prompt";
import { checkBudgetIntegrity, checkFeasibility, deriveConfidenceTiers } from "./engine/checks";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job, type RefinementRequest } from "./jobs";
import type { Itinerary, TripBriefInput } from "./types";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 12000;
const EFFORT = "low";

// Full search is the entire point of moving generation into a worker with
// no execution-time limit. Two tiers of rigor, by budget impact: lodging
// gets a deliberate two-search cross-check (below); restaurants/activities
// get a single verification search each (added after lodging-only proved
// out) — enough to confirm a named venue is real and roughly priced,
// without doubling the search budget for the lower-stakes category.
const SEARCH_INSTRUCTIONS = `You have a web_search tool available. Use it for two categories \
of items, with different rigor. Do not search for transit/transport items — those stay hedged \
estimates unless already covered by the provided facts.

LODGING (cross-checked — highest budget impact):
For each destination, perform TWO separate searches for its lodging price range (vary the query \
phrasing or target a different source each time) rather than relying on a single search — this is \
a deliberate cross-check, not a duplicate. Then:
- If the two results roughly agree (within about 20%), use a representative value from them for \
lodging cost_estimate_eur items in that destination, mark source_confidence as "grounded", set \
source_urls to both URLs used, and set source_agreement to "agree".
- If the two results meaningfully disagree, do NOT silently pick one. State both figures and both \
sources explicitly in the reasoning (e.g. "one source says X/night, another says Y — using the \
higher figure as the safer budget assumption"), set source_agreement to "disagree", and set \
source_urls to both URLs. Still use "grounded" if you can make a reasoned call between them; only \
use "inferred" if the disagreement is too large to responsibly resolve.
- If only one search returns a usable result for a destination, use it, set source_urls to that \
single URL, and leave source_agreement unset (null) — this is a single-source case, not a \
cross-check, and should be treated as slightly less certain in the reasoning.
- If no search returns anything usable for a destination, fall back to the existing hedged, \
inferred estimate — do not invent a false source. Set source_urls to an empty array and \
source_agreement to null.

RESTAURANTS AND ACTIVITIES (single verification search each):
For each meal or activity item that names a SPECIFIC venue (a named restaurant, museum, tour, \
paid attraction — not a generic, unnamed thing like "walk through the old town" or "relax at the \
hotel"), perform ONE search to confirm the venue is real, still operating, and to get a rough \
current price (entry fee, or typical meal cost). Then:
- If the search returns a usable result, set source_confidence to "grounded", source_urls to that \
one URL, and leave source_agreement unset (null) — this is single-source, not a cross-check.
- If the search returns nothing usable (venue not found, ambiguous, search fails), fall back to \
the existing hedged, inferred estimate — do not invent a false source.
- Skip searching generic/free items with no specific named venue — there's nothing to verify.
- Search budget is limited and shared across the whole itinerary. Prioritize the lodging \
cross-check first, then the most expensive or most decision-relevant named-venue items. If you \
run low on budget, it is fine to leave lower-stakes items hedged/inferred rather than cutting \
corners on lodging.

SHARED RULE FOR BOTH CATEGORIES — CRITICAL: never adjust a "grounded" number to fit the budget: \
whatever cost_estimate_eur you write for a "grounded" item MUST fall within (or match, for a \
single price) what its cited source(s) actually reported. Do NOT quietly write a lower number than \
your source found just because the trip's budget is tight — if the real number is high enough \
that it strains or breaks the budget, that IS the correct finding; report it as infeasible rather \
than manufacturing a cheaper "grounded" figure that isn't actually what you found. If you want to \
claim a cheaper option exists (e.g. a hostel instead of the hotels your search returned, or a \
cheaper restaurant instead of the one you searched), you must specifically search for and find \
that cheaper option — do not assume it without a citation backing that specific number. A cost \
figure invented to make the budget work, even with real citation links attached, is worse than no \
citation, because it looks verified when it isn't — never do this.

After any searches, output ONLY the final JSON matching the schema. Do not write any other text \
before, between, or after — no acknowledgment of the search, no commentary.`;

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

// Each real search costs more than 1 "use" here — the tool's dynamic
// filtering makes an internal code_execution call that eats into the same
// budget, so too low a count can be exhausted before a real query completes,
// causing a silent, unlogged fallback to an ungrounded estimate (empirically
// confirmed via a live test job). Budget for lodging's 2 cross-check
// searches per destination, plus 1 search for each of an estimated ~4
// named-venue meals/activities per day — a rough ceiling, since the actual
// count depends on what the model decides to name. Capped so a long trip
// can't runaway the search budget (and the cost/latency that comes with it).
function estimateMaxSearchUses(brief: TripBriefInput): number {
  const start = new Date(brief.start_date).getTime();
  const end = new Date(brief.end_date).getTime();
  const days =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.round((end - start) / 86_400_000) + 1
      : 3; // malformed dates are caught elsewhere — this is just a search-budget estimate
  const lodgingSearches = brief.destinations.length * 2;
  const itemSearches = days * 4;
  return Math.min((lodgingSearches + itemSearches) * 3, 60);
}

async function callModel(client: Anthropic, brief: TripBriefInput, userPrompt: string): Promise<Itinerary> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: SEARCH_INSTRUCTIONS },
    ],
    output_config: { effort: EFFORT },
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: estimateMaxSearchUses(brief),
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new ModelOutputError(
      "The model declined to generate this itinerary. Try adjusting the request."
    );
  }

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

async function withOneRetry(fn: () => Promise<Itinerary>): Promise<Itinerary> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ModelOutputError) {
      // Model occasionally returns malformed JSON — non-deterministic,
      // one retry usually succeeds.
      return await fn();
    }
    throw e;
  }
}

function generateItinerary(client: Anthropic, brief: TripBriefInput): Promise<Itinerary> {
  return withOneRetry(() => callModel(client, brief, buildPrompt(brief)));
}

/** Handles a pushback/follow-up request: re-sends the previously generated
 * itinerary plus the traveler's question, and asks the model to either
 * revise the itinerary or explain why it's standing firm — see
 * buildRefinementPrompt for the exact instructions given. */
function generateRefinement(client: Anthropic, brief: TripBriefInput, refinement: RefinementRequest): Promise<Itinerary> {
  return withOneRetry(() =>
    callModel(client, brief, buildRefinementPrompt(brief, refinement.baseItinerary, refinement.question))
  );
}

async function writeJob(redis: Redis, job: Job): Promise<void> {
  job.updatedAt = Date.now();
  await redis.set(jobKey(job.id), JSON.stringify(job), "EX", JOB_TTL_SECONDS);
}

async function processJob(redis: Redis, client: Anthropic, id: string): Promise<void> {
  const raw = await redis.get(jobKey(id));
  if (!raw) {
    console.error(`[worker] job ${id} not found (expired?), skipping`);
    return;
  }
  const job: Job = JSON.parse(raw);

  console.log(`[worker] processing ${id}: ${job.brief.destinations.join(", ")}`);
  job.status = "running";
  await writeJob(redis, job);

  try {
    let itinerary = job.refinement
      ? await generateRefinement(client, job.brief, job.refinement)
      : await generateItinerary(client, job.brief);
    itinerary = checkFeasibility(itinerary);
    itinerary = checkBudgetIntegrity(itinerary, job.brief);
    itinerary = deriveConfidenceTiers(itinerary);
    job.status = "done";
    job.result = itinerary;
  } catch (e) {
    console.error(`[worker] job ${id} failed:`, e);
    job.status = "error";
    job.error =
      e instanceof Anthropic.AuthenticationError
        ? "Server is misconfigured (invalid API key)."
        : e instanceof Anthropic.RateLimitError
          ? "Rate limited by the model provider. Try again shortly."
          : e instanceof Anthropic.APIConnectionError
            ? "Could not reach the model provider. Try again shortly."
            : e instanceof Anthropic.APIError
              ? `Model provider error: ${e.message}`
              : e instanceof ModelOutputError
                ? "The model's response was malformed twice in a row — try a shorter or simpler trip brief."
                : "Unexpected error generating itinerary.";
  }

  await writeJob(redis, job);
  console.log(`[worker] finished ${id}: ${job.status}`);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  const redis = getRedis();

  console.log("[worker] started, waiting for jobs on", JOBS_QUEUE_KEY);
  for (;;) {
    const popped = await redis.brpop(JOBS_QUEUE_KEY, 0); // blocks until a job arrives
    if (!popped) continue;
    const [, id] = popped;
    await processJob(redis, client, id).catch((e) => {
      console.error(`[worker] unhandled error processing ${id}:`, e);
    });
  }
}

main().catch((e) => {
  console.error("[worker] fatal error:", e);
  process.exit(1);
});
