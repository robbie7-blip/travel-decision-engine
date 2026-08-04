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
import { checkVenues } from "./engine/venueVerification";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job, type RefinementRequest } from "./jobs";
import { cacheLodgingFacts, loadCachedLodgingFacts } from "./lodgingCache";
import {
  ALERT_THRESHOLD_RATIO,
  DAILY_BUDGET_USD,
  alertKey,
  estimateCostUsd,
  spendKey,
  SPEND_KEY_TTL_SECONDS,
  type ModelUsage,
} from "./costBudget";
import type { Itinerary, TripBriefInput } from "./types";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 12000;
const EFFORT = "low";

// Full search is the entire point of moving generation into a worker with
// no execution-time limit — but per-item restaurant/activity searches were
// the single biggest generation-time cost (each search round-trip is a real
// model pause, easily several seconds, multiplied across ~4 named venues a
// day). Now that checkVenues (worker/src/engine/venueVerification.ts) does a
// fast, fully-parallelized Google Places lookup for every named venue right
// after generation, the model no longer needs to search them itself — it
// only searches for lodging, which stays the one price category Places
// doesn't cover. This roughly halves-or-better real generation time.
//
// Lodging itself is now a SINGLE search per destination, not a two-search
// cross-check: even after cutting meal/activity searches, a real trip still
// measured ~80s end to end, and each extra search is a real sequential model
// pause (the web_search tool's dynamic filtering does its own internal
// code_execution call per search, so two searches isn't just double the
// network time). A single grounded source per destination is still a real
// improvement over an inferred guess, and is reported as "single_source"
// confidence rather than "verified" — an honest, already-supported tier —
// rather than paying for a second round-trip just to upgrade that label.
const SEARCH_INSTRUCTIONS = `You have a web_search tool available. Use it ONLY for lodging price \
research and, when relevant (see FLIGHTS below), one round-trip flight/train price — do NOT use \
it for meals or activities, even ones that name a specific venue: a separate, much faster \
automated step verifies those (real business, open/closed status, rating, price tier) right after \
you finish, so spending search budget on them here only adds latency without adding trust.

LODGING:
For each destination, perform ONE search for its lodging price range — do not perform a second \
search for the same destination, even to cross-check; speed matters more here than a second \
opinion on a number that's already grounded once.
- If the search returns a usable result, use it for lodging cost_estimate_eur items in that \
destination, mark source_confidence as "grounded", set source_urls to that single URL, and leave \
source_agreement unset (null) — this is a single-source grounding, not a cross-check.
- If the search returns nothing usable for a destination, fall back to the existing hedged, \
inferred estimate — do not invent a false source. Set source_urls to an empty array and \
source_agreement to null.

FLIGHTS — only if a "Traveling from" origin is given AND transport is not already booked \
separately: perform ONE search for a real, current round-trip price on that specific route (name \
the obvious carrier if there is one, e.g. a budget/charter airline that's well known to operate \
that route — this is usually findable, not a shot in the dark). Use the result for the arrival \
transport item's cost_estimate_eur (the return-leg item stays free/zero-cost with a note that it's \
already covered, same as before), mark source_confidence "grounded", set source_urls to that URL, \
leave source_agreement unset (null). If the search returns nothing usable, fall back to a hedged, \
inferred estimate from general knowledge of typical fares for that route — do not invent a false \
source. Do not search for any other transit/transport item (local taxis, metro, etc.) — those stay \
hedged estimates unless already covered by the provided facts.

MEALS AND ACTIVITIES — DO NOT SEARCH: still name a real, specific venue per the NAME SPECIFIC \
VENUES rule, and still give your best hedged price estimate from general knowledge, but set \
source_confidence to "inferred" and source_urls to an empty array for these — the automated \
Places check afterward is what actually confirms the venue is real, open, and well-rated, and \
does it far faster than a per-item search would here.

CRITICAL: never adjust a "grounded" lodging number to fit the budget: whatever cost_estimate_eur \
you write for a "grounded" lodging item MUST fall within (or match, for a single price) what its \
cited source(s) actually reported. Do NOT quietly write a lower number than your source found just \
because the trip's budget is tight — if the real number is high enough that it strains or breaks \
the budget, that IS the correct finding; report it as infeasible rather than manufacturing a \
cheaper "grounded" figure that isn't actually what you found. A cost figure invented to make the \
budget work, even with a real citation link attached, is worse than no citation, because it looks \
verified when it isn't — never do this.

CURRENCY: a search result will often quote a price in the local currency (BRL, USD, THB, \
whatever), not EUR. Convert it to EUR yourself before writing cost_estimate_eur or mentioning that \
price anywhere in reasoning — never leave a raw local-currency figure in the output, even inside a \
citation-backed reasoning sentence. If the local pricing convention itself is unfamiliar to a \
European traveler (pay-by-weight, a per-person cover charge, a prix-fixe menu), translate it into \
an estimated total EUR cost for a typical portion or person, and explain the convention in plain \
terms rather than just repeating the local unit rate.

After any searches, output ONLY the final JSON matching the schema. Do not write any other text \
before, between, or after — no acknowledgment of the search, no commentary.`;

// Used instead of SEARCH_INSTRUCTIONS — and with no web_search tool declared
// at all — whenever every destination already has a cached, recently
// search-verified lodging price (see lodgingCache.ts). Not just "tell the
// model not to search": the tool itself is omitted from the request, so
// there's no possibility of the model spending a search round-trip on it
// regardless of how well it follows the instruction. This is the main lever
// for repeat/common-destination generations, which otherwise pay the same
// search latency every single time even though lodging prices barely change
// hour to hour.
const NO_SEARCH_INSTRUCTIONS = `No web_search tool is available for this generation. Every destination's lodging \
price has already been verified via a recent live search — see the "already verified" notes provided below for \
each destination. Reuse those exact figures and source_urls/source_agreement values for that destination's lodging \
item(s), set source_confidence to "grounded", and do not attempt to search.

Do not search for meals, activities, or transport either — a separate, much faster automated step verifies named \
meal/activity venues (real business, open/closed status, rating, price tier) right after you finish. Still name a \
real, specific venue per the NAME SPECIFIC VENUES rule, give your best hedged price estimate, and set \
source_confidence to "inferred" and source_urls to an empty array for those.

CURRENCY: if a cached lodging figure needs conversion, or you need to estimate any other price, convert to EUR \
yourself — never write a raw local-currency figure anywhere in the output.

Output ONLY the final JSON matching the schema. Do not write any other text before, between, or after — no \
commentary.`;

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

// True exactly when the itinerary will contain a real flight/train item to
// price — an origin was given AND the traveler hasn't already booked it
// separately (needs_flight defaults to true; only an explicit false turns
// it off, same convention as needs_lodging elsewhere in this file).
function needsFlightSearch(brief: TripBriefInput): boolean {
  return Boolean(brief.origin?.trim()) && brief.needs_flight !== false;
}

// Each real search costs more than 1 "use" here — the tool's dynamic
// filtering makes an internal code_execution call that eats into the same
// budget, so too low a count can be exhausted before a real query completes,
// causing a silent, unlogged fallback to an ungrounded estimate (empirically
// confirmed via a live test job). Budgets for lodging's single search per
// destination plus, when relevant, one flight search (see
// SEARCH_INSTRUCTIONS) — meals/activities are deliberately not searched by
// the model at all, so there's no per-day item budget to account for. This
// is the main lever behind cutting overall generation time: fewer searches
// means fewer multi-second round-trips in the critical path.
function estimateMaxSearchUses(brief: TripBriefInput): number {
  const searches = brief.destinations.length + (needsFlightSearch(brief) ? 1 : 0);
  return Math.min(searches * 3, 15);
}

async function callModel(
  client: Anthropic,
  brief: TripBriefInput,
  userPrompt: string,
  onUsage?: (usage: ModelUsage) => void,
  skipSearch = false
): Promise<Itinerary> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: skipSearch ? NO_SEARCH_INSTRUCTIONS : SEARCH_INSTRUCTIONS },
    ],
    output_config: { effort: EFFORT },
    ...(skipSearch
      ? {}
      : {
          tools: [
            {
              type: "web_search_20260209" as const,
              name: "web_search",
              max_uses: estimateMaxSearchUses(brief),
            },
          ],
        }),
    messages: [{ role: "user", content: userPrompt }],
  });

  // Anthropic bills for this call whether or not the response below turns
  // out to be a refusal or malformed JSON, so usage is recorded right away
  // rather than only on a successful parse.
  onUsage?.(response.usage);

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

function generateItinerary(
  client: Anthropic,
  brief: TripBriefInput,
  cachedLodgingFacts: Record<string, string>,
  onUsage?: (usage: ModelUsage) => void
): Promise<Itinerary> {
  // Skip the web_search tool entirely — not just instruct around it — when
  // every destination already has a cached, recently-verified lodging price
  // AND there's no flight leg to price, so a repeat/common-destination
  // generation pays zero search latency rather than relying on the model
  // choosing not to search. A flight search always keeps the tool available,
  // even with fully-cached lodging, since flight prices aren't cached.
  const allLodgingCached = brief.destinations.every((d) => d in cachedLodgingFacts);
  const skipSearch = allLodgingCached && !needsFlightSearch(brief);
  return withOneRetry(() =>
    callModel(client, brief, buildPrompt(brief, cachedLodgingFacts), onUsage, skipSearch)
  );
}

/** Handles a pushback/follow-up request: re-sends the previously generated
 * itinerary plus the traveler's question, and asks the model to either
 * revise the itinerary or explain why it's standing firm — see
 * buildRefinementPrompt for the exact instructions given. */
function generateRefinement(
  client: Anthropic,
  brief: TripBriefInput,
  refinement: RefinementRequest,
  onUsage?: (usage: ModelUsage) => void
): Promise<Itinerary> {
  return withOneRetry(() =>
    callModel(client, brief, buildRefinementPrompt(brief, refinement.baseItinerary, refinement.question), onUsage)
  );
}

async function writeJob(redis: Redis, job: Job): Promise<void> {
  job.updatedAt = Date.now();
  await redis.set(jobKey(job.id), JSON.stringify(job), "EX", JOB_TTL_SECONDS);
}

/** Fires once per day, the first time a spend update pushes the running
 * total past ALERT_THRESHOLD_RATIO of the budget — a loud log line always,
 * plus a POST to BUDGET_ALERT_WEBHOOK_URL if one is configured (a generic
 * {text: string} payload, compatible with Slack/Discord-style incoming
 * webhooks). Purely an early warning: checkDailyBudget on the frontend is
 * what actually blocks new generations at 100%, unaffected by this. */
async function maybeAlertBudgetThreshold(redis: Redis, totalSpentUsd: number): Promise<void> {
  if (totalSpentUsd < DAILY_BUDGET_USD * ALERT_THRESHOLD_RATIO) return;

  // SET ... NX so only the job whose spend update first crosses the
  // threshold today fires the alert, even if several jobs finish at once.
  const firstToCross = await redis.set(alertKey(), "1", "EX", SPEND_KEY_TTL_SECONDS, "NX");
  if (firstToCross !== "OK") return;

  const message =
    `[worker] BUDGET ALERT: today's spend is $${totalSpentUsd.toFixed(2)} of a $${DAILY_BUDGET_USD.toFixed(2)} ` +
    `daily cap (${Math.round(ALERT_THRESHOLD_RATIO * 100)}%+) — new generations will be rejected once the cap is reached.`;
  console.warn(message);

  const webhookUrl = process.env.BUDGET_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (e) {
    console.error("[worker] failed to POST budget alert webhook:", e);
  }
}

/** Adds this job's estimated cost onto today's running total — the
 * counterpart to checkDailyBudget on the frontend, which reads this same
 * key before enqueueing new jobs. Called once per job regardless of
 * success/failure/retries, since a retry after malformed JSON still bills
 * a second model call. */
async function recordSpend(redis: Redis, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const key = spendKey();
  const newTotal = await redis.incrbyfloat(key, costUsd);
  await redis.expire(key, SPEND_KEY_TTL_SECONDS);
  await maybeAlertBudgetThreshold(redis, Number(newTotal));
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

  let costUsd = 0;
  const onUsage = (usage: ModelUsage) => {
    costUsd += estimateCostUsd(usage);
  };

  try {
    let itinerary: Itinerary;
    if (job.refinement) {
      itinerary = await generateRefinement(client, job.brief, job.refinement, onUsage);
    } else {
      const cachedLodgingFacts = await loadCachedLodgingFacts(redis, job.brief.destinations);
      itinerary = await generateItinerary(client, job.brief, cachedLodgingFacts, onUsage);
    }
    itinerary = checkFeasibility(itinerary);
    itinerary = checkBudgetIntegrity(itinerary, job.brief);
    itinerary = deriveConfidenceTiers(itinerary);
    itinerary = await checkVenues(itinerary);
    job.status = "done";
    job.result = itinerary;
    await cacheLodgingFacts(redis, job.brief, itinerary);
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

  await recordSpend(redis, costUsd);
  await writeJob(redis, job);
  console.log(`[worker] finished ${id}: ${job.status}${costUsd > 0 ? ` (~$${costUsd.toFixed(4)})` : ""}`);
}

// How many jobs this single worker process handles at once. Jobs are
// almost entirely I/O wait (Anthropic, Google Places, Open-Meteo network
// calls), not CPU, so a handful of them genuinely run concurrently in one
// Node process rather than fighting over the event loop. This is the fix
// for a real, confirmed bug: comparison mode creates two jobs at once, but
// with a single consumer they were processed strictly one after another —
// the second column's loading screen didn't even start its own generation
// until the first column's had entirely finished — turning what should be
// two ~1-minute generations running side by side into one that's additive
// (2+ minutes before the second column showed anything).
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

/** One consumer's loop: block on the queue, process a job, repeat. Uses its
 * own dedicated Redis connection (via redis.duplicate()) purely for the
 * blocking BRPOP call — a blocking command occupies its whole connection
 * until it returns, so sharing one connection across concurrent consumers
 * (or with any other command) would serialize everything behind whichever
 * BRPOP is currently waiting, defeating the entire point of running several
 * consumers. All the actual job work (reads/writes/etc.) goes through the
 * one shared non-blocking `sharedRedis` connection instead, which is safe
 * to use concurrently since none of those calls block. */
async function runConsumer(consumerId: number, sharedRedis: Redis, client: Anthropic): Promise<void> {
  const queueConn = sharedRedis.duplicate();
  try {
    for (;;) {
      const popped = await queueConn.brpop(JOBS_QUEUE_KEY, 0); // blocks until a job arrives
      if (!popped) continue;
      const [, id] = popped;
      await processJob(sharedRedis, client, id).catch((e) => {
        console.error(`[worker ${consumerId}] unhandled error processing ${id}:`, e);
      });
    }
  } finally {
    queueConn.disconnect();
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  const redis = getRedis();

  console.log(`[worker] started, ${WORKER_CONCURRENCY} concurrent consumer(s) waiting on`, JOBS_QUEUE_KEY);
  await Promise.all(
    Array.from({ length: WORKER_CONCURRENCY }, (_, i) => runConsumer(i, redis, client))
  );
}

main().catch((e) => {
  console.error("[worker] fatal error:", e);
  process.exit(1);
});
