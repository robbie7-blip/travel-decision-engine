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
import { buildPrompt, SYSTEM_PROMPT } from "./engine/prompt";
import { checkBudgetIntegrity, checkFeasibility } from "./engine/checks";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job } from "./jobs";
import type { Itinerary, TripBriefInput } from "./types";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 12000;
const EFFORT = "low";

// Not behind a flag here — full search is the entire point of moving
// generation into a worker with no execution-time limit. Still scoped to
// lodging pricing only (the highest-volatility, highest-budget-impact
// category) until broader scope is measured and deliberately expanded.
const SEARCH_INSTRUCTIONS = `You have a web_search tool available. Use it ONLY to check \
current typical lodging price ranges (budget and mid-range, per night) for each destination in \
this trip — nothing else. Do not search for restaurants, activities, transit, or anything not \
about lodging pricing.

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

async function callModel(client: Anthropic, brief: TripBriefInput): Promise<Itinerary> {
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
        // Each real search costs more than 1 "use" here — the tool's dynamic
        // filtering makes an internal code_execution call that eats into the
        // same budget, so too low a count can be exhausted before a real
        // query completes, causing a silent, unlogged fallback to an
        // ungrounded estimate (empirically confirmed via a live test job).
        // Cross-checking now asks for 2 real searches per destination, so the
        // budget is roughly doubled from the single-search version.
        max_uses: Math.min(Math.max(brief.destinations.length * 6, 6), 20),
      },
    ],
    messages: [{ role: "user", content: buildPrompt(brief) }],
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

async function generateItinerary(client: Anthropic, brief: TripBriefInput): Promise<Itinerary> {
  try {
    return await callModel(client, brief);
  } catch (e) {
    if (e instanceof ModelOutputError) {
      // Model occasionally returns malformed JSON — non-deterministic,
      // one retry usually succeeds.
      return await callModel(client, brief);
    }
    throw e;
  }
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
    let itinerary = await generateItinerary(client, job.brief);
    itinerary = checkFeasibility(itinerary);
    itinerary = checkBudgetIntegrity(itinerary, job.brief);
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
