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
import {
  assembleItinerary,
  buildDayPrompt,
  buildFramePrompt,
  buildPlanPrompt,
  getDayInstructions,
  getFrameSystemPrompt,
  getPlanSystemPrompt,
  mergeSkeleton,
  applyVerifiedAccommodation,
  isUsableFrame,
  isUsablePlan,
  stripVenueIdentity,
  type MealSlot,
  type SkeletonDay,
  type TripFrame,
  type TripPlan,
  type TripSkeleton,
} from "./engine/twoPhase";
import { checkBudgetIntegrity, checkFeasibility, deriveConfidenceTiers } from "./engine/checks";
import {
  assessQuality,
  duplicateVenueItems,
  mealSlotOf,
  missingMealsFor,
  summarizeQuality,
} from "./engine/quality";
import { checkVenues } from "./engine/venueVerification";
import { attachFlightSearchLinks } from "./engine/flightLinks";
import { applyFlightPricing, fetchFarePricing } from "./engine/flightPricing";
import { recordFareObservation } from "./fareHistory";
import { recordQualitySample } from "./qualityStats";
import { JOBS_QUEUE_KEY, JOB_TTL_SECONDS, jobKey, type Job, type JobTimings, type RefinementRequest } from "./jobs";
import { cacheLodgingFacts, loadCachedLodgingFacts, writeCachedLodgingFact } from "./lodgingCache";
import {
  ALERT_THRESHOLD_RATIO,
  DAILY_BUDGET_USD,
  alertKey,
  estimateCostUsd,
  spendKey,
  SPEND_KEY_TTL_SECONDS,
  type ModelUsage,
} from "./costBudget";
import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "./types";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 12000;
// The single largest quality knob available, and it had been pinned to the
// minimum since before any of the latency work — not because low effort was
// judged good enough, but because it was the cheapest way to make
// generation fast. That is the wrong trade for this product: the whole
// pitch is that the reasoning is worth trusting, and effort is exactly the
// setting that buys reasoning.
//
// "high" costs real time and real money per generation. That is the
// intended trade. MODEL_EFFORT overrides it without a code change if the
// balance ever needs revisiting — "low" restores the old behaviour exactly.
const EFFORT = (process.env.MODEL_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max";

// Effort for the pipeline's small EXTRACTION calls: read a search result
// into two JSON fields, swap one duplicated venue for another. Raising
// MODEL_EFFORT to "high" was applied to every call in the pipeline
// indiscriminately, including these, and that was a mistake in both
// directions at once.
//
// It bought nothing: there is no judgement in "which number in this page is
// the nightly rate", so extra reasoning has no quality to add. And it cost
// something real, because these calls have deliberately tiny token caps
// (they emit two fields) — reasoning is drawn from the same budget as the
// answer, so a high-effort call under a 400-token cap can spend the whole
// cap thinking and return no JSON at all. That failure is silent by design
// here (a lodging lookup that fails degrades to a generic estimate rather
// than failing the trip), which is exactly how a generation ends up
// reporting "a mid-range hotel, unverified estimate" when a real property
// lookup was supposed to have run.
//
// Both halves of that are fixed: low effort where there is nothing to
// reason about, and caps below with enough headroom that reasoning can
// never starve the output.
const EXTRACT_EFFORT = (process.env.EXTRACT_MODEL_EFFORT ?? "low") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

// Headroom, not a target. These calls emit ~50 tokens of JSON; the cap
// exists to bound a runaway, and the old 400/500 values were sized when
// effort was pinned low and nothing else drew on the budget.
const LODGING_MAX_TOKENS = 2000;
const REPAIR_MAX_TOKENS = 1500;

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
//
// Flights are deliberately NOT searched (tried it, reverted it): it added a
// full extra search round-trip back onto every generation with an origin —
// confirmed pushing real generation time toward 2 minutes — and worse, the
// number it found was actually wrong in practice: a live test showed the
// model reporting a confident "single_source" EUR240 round-trip fare while
// the real Google Flights price for that exact route/dates, one line below
// it via the deterministic link attachFlightSearchLinks always attaches
// (see engine/flightLinks.ts), was EUR43 — a self-contradicting itinerary,
// and a worse outcome than just being honest that it's a ballpark. Dynamic
// airline pricing isn't something a single web_search reliably nails down
// the way a lodging price range is; the real Google Flights link is the
// actual verification mechanism for flights, the same relationship Google
// Maps links already have with venues. Flight cost_estimate_eur is back to
// a plain hedged, inferred estimate, same as any other transport item.
const SEARCH_INSTRUCTIONS = `You have a web_search tool available. Use it ONLY for lodging price \
research — do NOT use it for meals, activities, or transport (including flights/trains), even ones \
that name a specific venue or carrier: a separate, much faster automated step verifies named \
venues (real business, open/closed status, rating, price tier) right after you finish, and flight \
items get a real, clickable Google Flights link attached automatically — so spending search budget \
on either here only adds latency without adding trust.

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

MEALS, ACTIVITIES, AND TRANSPORT (including flights) — DO NOT SEARCH: still name a real, specific \
venue per the NAME SPECIFIC VENUES rule for meals/activities, and still give your best hedged \
price estimate from general knowledge for all of these (a typical current fare/price range for the \
route or category is fine — you don't need to know today's exact number), but set \
source_confidence to "inferred" and source_urls to an empty array — the automated Places check and \
the attached Google Flights link are what actually let the traveler verify these, and do it far \
faster and more reliably than a per-item search would here.

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

// Each real search costs more than 1 "use" here — the tool's dynamic
// filtering makes an internal code_execution call that eats into the same
// budget, so too low a count can be exhausted before a real query completes,
// causing a silent, unlogged fallback to an ungrounded estimate (empirically
// confirmed via a live test job). Only budgets for lodging's single search
// per destination now — meals, activities, and transport (including
// flights) are deliberately not searched by the model at all (see
// SEARCH_INSTRUCTIONS), so there's no other budget to account for. This is
// the main lever behind cutting overall generation time: fewer searches
// means fewer multi-second round-trips in the critical path.
function estimateMaxSearchUses(brief: TripBriefInput): number {
  return Math.min(brief.destinations.length * 3, 12);
}

// A single destination's lodging price, fetched on its own rather than as
// part of the main itinerary-writing call. The old design had the model do
// this search INLINE, mid-conversation, once per destination — for an
// N-destination trip that's N sequential search pauses stacked in front of
// (and adding straight onto) the time it separately takes to write the
// whole itinerary, all inside one linear call. Firing one of these per
// missing destination via Promise.all (see the prefetch step in
// processJob) turns that into max(N parallel lookups) instead of their
// sum, then hands the main call a fully-cached brief so it can always take
// the fast NO_SEARCH_INSTRUCTIONS path — no tool-use turn in the critical
// generation call at all. The prompt/output here is deliberately tiny
// (a handful of tokens, not a whole schema) so this call's own non-search
// portion is as close to free as possible; the wall-clock cost is close to
// pure search latency.
// Asks for a real, specific property AND its nightly rate in the same
// search, rather than a city-wide average. That pairing matters for
// honesty, not just usefulness: a city-average rate is a fair thing to
// print next to "a mid-range hotel", but bolting a named property onto an
// average would quietly claim to be quoting THAT hotel's price when it
// isn't. One lookup that returns both keeps the name and the number
// describing the same thing.
//
// "name": null is a first-class, expected outcome — plenty of searches
// surface a credible rate without a single property worth committing to,
// and lodgingCache falls back to the original generic wording for those.
const LODGING_RATE_SYSTEM = `Find the current typical price per night for a mid-range hotel in the given city, \
using web search.

Respond with ONLY this JSON, no other text:
{"cost_estimate_eur": <number, converted to EUR if the source quoted another currency>, "source_url": "<the URL you used>"}

If nothing usable is found, return exactly: {"cost_estimate_eur": null, "source_url": null}. Never invent a number \
or a URL.`;

const LODGING_PROPERTY_SYSTEM = `Find a real, specific, well-reviewed mid-range hotel in the given city that a \
traveler would actually be happy staying in. Take the time to pick a good one — somewhere with a solid reputation \
and a sensible central-ish location, not merely the first result.

Respond with ONLY this JSON, no other text:
{"name": "<the hotel's real proper name>", "area": "<its neighborhood or district>"}

If you cannot find a specific property you would confidently name, return exactly: {"name": null, "area": null}. \
Never invent a hotel that might not exist — a generic accommodation line is far better than a fabricated name.`;

interface LodgingLookupResult {
  /** Null when the rate search came back with nothing usable. The property
   * half is reported anyway in that case — see the return below. */
  costEstimateEur: number | null;
  sourceUrl: string | null;
  name: string | null;
  area: string | null;
}

/** Rate and property are two genuinely different questions — "what does a
 * night cost here" and "which specific hotel is worth naming" — and an
 * earlier version tried to answer both from a single search to save a
 * round-trip. That cost quality: the search that finds a good price article
 * is rarely the one that surfaces a property worth committing to, so the
 * name came back null far more often than it should have and accommodation
 * silently degraded to "a mid-range hotel", which is the single least
 * verifiable line in the itinerary and usually its biggest number.
 *
 * They're independent, so they run CONCURRENTLY instead. Two dedicated
 * searches, each free to do its own job properly, at the wall-clock cost of
 * one — the version that collapsed them was trading away real quality for
 * latency it didn't actually need to save. */
async function prefetchLodging(
  client: Anthropic,
  city: string,
  onUsage?: (usage: ModelUsage) => void
): Promise<LodgingLookupResult | null> {
  async function ask<T>(system: string, maxUses: number): Promise<T | null> {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: LODGING_MAX_TOKENS,
        system,
        output_config: { effort: EXTRACT_EFFORT },
        tools: [{ type: "web_search_20260209" as const, name: "web_search", max_uses: maxUses }],
        messages: [{ role: "user", content: `City: ${city}` }],
      });
      onUsage?.(response.usage);
      // Named explicitly rather than left to surface as a JSON parse error
      // below: the two have identical symptoms (null result, generic
      // accommodation) and completely different fixes, and mistaking one
      // for the other is what hid a silently-degraded lodging lookup.
      if (response.stop_reason === "max_tokens") {
        console.error(
          `[worker] lodging lookup for ${city} hit the ${LODGING_MAX_TOKENS}-token cap before emitting JSON`
        );
        return null;
      }
      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      const text = textBlocks[textBlocks.length - 1]?.text ?? "";
      return JSON.parse(extractJson(text)) as T;
    } catch (e) {
      // Either half failing degrades the result rather than the run: no rate
      // means no cached lodging fact for this city, no property means a
      // generic accommodation line. Never fails the generation.
      console.error(`[worker] lodging lookup failed for ${city}:`, e);
      return null;
    }
  }

  const [rate, property] = await Promise.all([
    ask<{ cost_estimate_eur: number | null; source_url: string | null }>(LODGING_RATE_SYSTEM, 2),
    ask<{ name: string | null; area: string | null }>(LODGING_PROPERTY_SYSTEM, 2),
  ]);

  const costEstimateEur = rate?.cost_estimate_eur ?? null;
  const sourceUrl = rate?.source_url ?? null;
  const name = property?.name?.trim() || null;
  const area = property?.area?.trim() || null;

  // The two halves fail independently, so they're reported independently.
  // This used to return null unless the RATE came back, which threw away a
  // successfully-found property whenever the price search happened to miss
  // — and the property is the half the traveler actually sees. A named
  // hotel with the frame's own hedged price estimate is a strictly better
  // line than "a mid-range hotel" at the same price.
  if (costEstimateEur == null && !name) return null;
  return { costEstimateEur, sourceUrl, name, area };
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
    // cache_control on this last system block caches SYSTEM_PROMPT (~3K
    // tokens, well above Sonnet 5's 1024-token minimum) together with
    // whichever instructions variant follows it (and the web_search tool
    // definition too, per the render order tools -> system -> messages) — a
    // single breakpoint covers the whole shared prefix. This text is
    // byte-identical across every job with the same skipSearch value, and
    // in particular a refine call almost always follows its own generate
    // call within the same session, seconds to minutes later — precisely
    // the repeat-prefix pattern caching is for. Reads cost ~0.1x the base
    // input rate vs. paying full price for the same ~3K tokens every call.
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      {
        type: "text",
        text: skipSearch ? NO_SEARCH_INSTRUCTIONS : SEARCH_INSTRUCTIONS,
        cache_control: { type: "ephemeral" },
      },
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

/** Generic over the call's result type so the two-phase generator's skeleton
 * and per-day calls get the same one-retry treatment the single-call path
 * has always had — malformed JSON is non-deterministic, and a retry costs
 * far less than failing a whole generation over it. */
async function withOneRetryOf<T>(fn: () => Promise<T>): Promise<T> {
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

const withOneRetry = withOneRetryOf<Itinerary>;

/** Retries a call that came back rate-limited, backing off between
 * attempts. This is what lets MAX_PARALLEL_DAYS sit above any realistic
 * trip length: fanning a 14-day trip out at once is only reckless if a 429
 * is fatal, and here it isn't. Honours the provider's own Retry-After when
 * it sends one, since that number is better than any guess made here.
 *
 * Only rate limits and connection errors are retried. A malformed response
 * is somebody else's job (withOneRetryOf), and an auth error retried three
 * times is just an auth error three times. */
async function withRateLimitRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const backoffsMs = [1000, 3000, 7000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryable =
        e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError;
      if (!retryable || attempt >= backoffsMs.length) throw e;
      const headers = (e as { headers?: Headers }).headers;
      const headerSeconds = Number(headers?.get?.("retry-after") ?? NaN);
      const waitMs = Number.isFinite(headerSeconds)
        ? Math.min(headerSeconds * 1000, 15000)
        : backoffsMs[attempt];
      console.warn(`[worker] ${label} rate-limited, retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// Two-phase parallel generation (see engine/twoPhase.ts for the full
// rationale) — on by default, since one call streaming the whole itinerary
// out sequentially is the dominant remaining cost in generation wall-time.
// Set TWO_PHASE_GENERATION=0 to fall back to the original single-call path
// for every job, without a deploy of different code.
const TWO_PHASE_ENABLED = process.env.TWO_PHASE_GENERATION !== "0";

// Model used for the phase-2 day calls only. Phase 1 (every real decision:
// budget, city order, which venues anchor which day) always stays on MODEL.
// Phase 2 is comparatively mechanical — expand an already-decided day into
// items under rules it's handed verbatim — so a faster model is a genuine
// latency lever here in a way it wouldn't be for phase 1. Defaults to the
// same model as phase 1 (zero quality change vs. today); set DAY_MODEL to
// a faster one to trade some prose polish for a materially shorter phase 2.
const DAY_MODEL = process.env.DAY_MODEL ?? MODEL;

// Caps how many day calls are in flight at once. Days are pure I/O wait, so
// this isn't about CPU — it's about not opening an unbounded number of
// concurrent Anthropic requests when a long trip and comparison mode (two
// jobs at once, see WORKER_CONCURRENCY) coincide, which is how you trip
// provider rate limits and end up slower than the serial path you replaced.
//
// It was 6, which quietly made phase 2 cost TWO waves for any trip longer
// than six days — a 10-day trip paid max(day) twice, and the whole reason
// phase 2 exists is to pay it once. Worse, it was invisible: the stage
// timing showed "days: 48s" either way, so a long trip looked like it just
// had slow days.
//
// The rate-limit worry behind the low number is real but was being paid up
// front by every long trip, forever, to avoid an event that may never
// happen. A 429 is now handled where it actually occurs (see
// withRateLimitRetry) instead, so the cap can sit above any realistic trip
// length and a genuine rate limit costs one backoff on one day call rather
// than a permanent extra wave on all of them.
const MAX_PARALLEL_DAYS = Number(process.env.MAX_PARALLEL_DAYS ?? 16);

const SKELETON_MAX_TOKENS = 12000;
const DAY_MAX_TOKENS = 6000;

async function runWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** One phase-2 call: expands a single already-planned day into real items.
 * No tools declared at all — every price that needed a live lookup was
 * already resolved by prefetchLodging and carried through the skeleton, so
 * there is nothing here worth a search round-trip. */
async function generateDay(
  client: Anthropic,
  brief: TripBriefInput,
  skeleton: TripSkeleton,
  day: SkeletonDay,
  onUsage?: (usage: ModelUsage) => void
): Promise<ItineraryDay> {
  const response = await client.messages.create({
    model: DAY_MODEL,
    // Also raised: a day now carries all three meals plus activities plus
    // accommodation plus any transport leg, not the sparser day the original
    // 4000 was sized for.
    max_tokens: DAY_MAX_TOKENS,
    // Same two-block shape (and so the same shared, cached prefix) as the
    // single-call path: SYSTEM_PROMPT is byte-identical across every day
    // call of every job, so after the first call in a job the whole prefix
    // is a cache read rather than N full re-sends of a ~4K-token prompt.
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: getDayInstructions(), cache_control: { type: "ephemeral" } },
    ],
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: buildDayPrompt(brief, skeleton, day) }],
  });
  onUsage?.(response.usage);

  if (response.stop_reason === "refusal") {
    throw new ModelOutputError(`The model declined to generate day ${day.day}.`);
  }
  // Truncation is worth naming explicitly rather than letting it surface as
  // "bad JSON" further down: the symptom is identical, but the fix is a
  // token cap rather than a prompt, and mistaking one for the other is how
  // a silent, expensive retry-then-fall-back loop hides in plain sight.
  if (response.stop_reason === "max_tokens") {
    throw new ModelOutputError(
      `Day ${day.day} hit the ${DAY_MAX_TOKENS}-token cap and was cut off mid-JSON — raise DAY_MAX_TOKENS.`
    );
  }

  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const text = textBlocks[textBlocks.length - 1]?.text ?? "";
  let parsed: ItineraryDay;
  try {
    parsed = JSON.parse(extractJson(text)) as ItineraryDay;
  } catch (e) {
    throw new ModelOutputError(`Day ${day.day} was not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed?.items)) {
    throw new ModelOutputError(`Day ${day.day} came back with no items array.`);
  }
  // The model is told its own day number and date, but the skeleton is the
  // authority on both — a day that renumbers itself would silently reorder
  // or collide once merged.
  parsed.day = day.day;
  parsed.date = day.date;
  parsed.feasibility_flag = parsed.feasibility_flag ?? null;
  return parsed;
}

const VENUE_REPAIR_SYSTEM = `You are fixing ONE line of a travel itinerary. It currently names a venue that is \
already used elsewhere in the same trip, so the traveler would see the same place twice. Replace it with a \
DIFFERENT real, specific, named venue that fits the same slot just as well.

The replacement must be a real business you actually believe exists in that city, appropriate to the slot (a \
breakfast spot for breakfast, not a dinner restaurant), and must not be any of the venues already used.

Respond with ONLY this JSON, no other text:
{"title": "<the item's new title, naming the new venue, in the same language as the original title>", "venue_name": "<the new venue's exact proper name>", "reasoning": "<one short sentence, <=15 words, why this place>"}

If you genuinely cannot name a different real venue for this slot, return exactly: {"title": null, "venue_name": null, "reasoning": null}.`;

/** Replaces duplicate venues with real alternatives rather than stripping
 * their names.
 *
 * Parallel day calls can't see each other, so two days can independently
 * reach for the same obvious central cafe. The cheap response is to un-name
 * the later one, but that swaps a visible flaw for a worse one: the item
 * keeps its slot and loses the specific, checkable venue that is the entire
 * reason to use this product over a generic chatbot. So each duplicate gets
 * a small, targeted call that knows every name already in the trip and
 * picks a genuinely different one.
 *
 * Only runs when a duplicate actually exists, and all repairs run
 * concurrently. Un-naming survives strictly as the last resort, for when
 * even the replacement call can't produce something real. */
async function repairDuplicateVenues(
  client: Anthropic,
  brief: TripBriefInput,
  itinerary: Itinerary,
  // Every venue name already spoken for in this trip, shared with the
  // missing-meal repair that runs alongside this one. Both hand out new
  // venue names concurrently, and a set per function would let them
  // independently pick the same "different" restaurant — reintroducing the
  // exact duplicate one of them exists to remove.
  claimed: Set<string>,
  onUsage?: (usage: ModelUsage) => void,
  /** Collects every item whose venue changed, so the caller can send just
   * those back through Places rather than re-verifying the whole trip. */
  repaired?: ItineraryItem[]
): Promise<void> {
  const dupes = duplicateVenueItems(itinerary.days ?? []);
  if (dupes.length === 0) return;
  console.log(`[worker] repairing ${dupes.length} duplicate venue(s)`);

  await Promise.all(
    dupes.map(async ({ item, day }) => {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: REPAIR_MAX_TOKENS,
          system: VENUE_REPAIR_SYSTEM,
          output_config: { effort: EXTRACT_EFFORT },
          messages: [
            {
              role: "user",
              content:
                `Where: ${item.location || brief.destinations[0]}\n` +
                `Date: ${day.date}\n` +
                `Slot: ${item.time} (${item.type})\n` +
                `Current title (duplicate): ${item.title}\n` +
                `Venue to replace: ${item.venue_name}\n` +
                `Language: write the title in the same language as the current title.\n` +
                `Already used in this trip, do NOT reuse any of these: ${[...claimed].join("; ")}`,
            },
          ],
        });
        onUsage?.(response.usage);
        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
        const parsed = JSON.parse(extractJson(textBlocks[textBlocks.length - 1]?.text ?? "")) as {
          title: string | null;
          venue_name: string | null;
          reasoning: string | null;
        };
        if (!parsed.venue_name || !parsed.title || claimed.has(parsed.venue_name.toLowerCase())) {
          stripVenueIdentity(item);
          return;
        }
        claimed.add(parsed.venue_name.toLowerCase());
        item.title = parsed.title;
        item.venue_name = parsed.venue_name;
        if (parsed.reasoning) item.reasoning = parsed.reasoning;
        // A replaced venue has not been through Places yet, and its old
        // verification belonged to a different business entirely.
        item.google_rating = undefined;
        item.google_rating_count = undefined;
        item.google_price_level = undefined;
        item.google_business_status = undefined;
        item.google_maps_url = undefined;
        item.source_confidence = "inferred";
        item.source_urls = [];
        item.google_open_on_visit = undefined;
        item.google_opening_hours = undefined;
        repaired?.push(item);
      } catch (e) {
        console.error(`[worker] venue repair failed for "${item.venue_name}":`, e);
        stripVenueIdentity(item);
      }
    })
  );
}

/** One half of phase 1. Both halves are the same call shape — a cached
 * system prompt, no tools, JSON out — so the only things that vary are
 * which prompt, which validator, and what to call it in an error. */
async function generatePhase1Half<T>(
  client: Anthropic,
  label: string,
  system: string,
  userPrompt: string,
  isUsable: (v: unknown) => v is T,
  onUsage?: (usage: ModelUsage) => void
): Promise<T> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: SKELETON_MAX_TOKENS,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: userPrompt }],
  });
  onUsage?.(response.usage);

  if (response.stop_reason === "refusal") {
    throw new ModelOutputError("The model declined to plan this trip.");
  }
  // See the day-call equivalent above. This one matters more: a truncated
  // phase 1 costs a retry AND then a full single-call regeneration.
  if (response.stop_reason === "max_tokens") {
    throw new ModelOutputError(
      `The ${label} hit the ${SKELETON_MAX_TOKENS}-token cap and was cut off mid-JSON — raise SKELETON_MAX_TOKENS.`
    );
  }

  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const text = textBlocks[textBlocks.length - 1]?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (e) {
    throw new ModelOutputError(`The ${label} was not valid JSON: ${(e as Error).message}`);
  }
  if (!isUsable(parsed)) {
    throw new ModelOutputError(`The ${label} was missing required fields.`);
  }
  return parsed;
}

const MEAL_REPAIR_SYSTEM = `You are filling ONE missing meal in a travel itinerary. The day was planned to \
include this meal and the write-up left it out, so the traveler currently has a gap where a meal should be.

Name a real, specific restaurant/cafe/bakery in that city, appropriate to the meal and to the rest of the day, \
and not one of the venues already used anywhere in the trip.

Respond with ONLY this JSON, no other text:
{"time": "<clock time or time-of-day phrase, in the same language as the day's other items>", "title": "<the item's title, naming the venue, in that same language>", "venue_name": "<the venue's exact proper name>", "location": "<neighborhood, city>", "cost_estimate_eur": <number, per person, EUR>, "reasoning": "<one short sentence, <=15 words, why this place>"}

Never use an em dash. If you genuinely cannot name a real venue for this slot, return exactly: {"venue_name": null}.`;

/** Adds back any meal the day plan called for and the day write-up dropped.
 *
 * A trip came back with days that had a flight, a transfer and a hotel and
 * no food at all, and with full days that went from a morning sight
 * straight to the accommodation. The instruction to include every meal was
 * there; it was competing with "downtime that fits the stated pace" and
 * losing. The instruction is now an explicit per-day list (see
 * SkeletonDay.meals), which is a much harder thing to talk yourself out of,
 * and this is the check that the list was actually honoured.
 *
 * Deliberately a repair rather than a warning. A missing lunch is not
 * something to tell a traveler about, it is something to fix, and it is
 * cheap to fix: one small call per gap, all of them concurrent, in the same
 * stage as the duplicate-venue repair so the critical path gains no step. */
async function repairMissingMeals(
  client: Anthropic,
  brief: TripBriefInput,
  skeletonDays: SkeletonDay[],
  itinerary: Itinerary,
  /** Shared with repairDuplicateVenues — see the note on its parameter. */
  taken: Set<string>,
  onUsage?: (usage: ModelUsage) => void,
  /** See repairDuplicateVenues — the added meals go back through Places. */
  repaired?: ItineraryItem[]
): Promise<void> {
  const planByNumber = new Map(skeletonDays.map((d) => [d.day, d]));
  const jobs: { day: ItineraryDay; plan: SkeletonDay; meal: MealSlot }[] = [];
  for (const day of itinerary.days ?? []) {
    const plan = planByNumber.get(day.day);
    if (!plan) continue;
    for (const meal of missingMealsFor(day, plan)) jobs.push({ day, plan, meal });
  }
  if (jobs.length === 0) return;
  console.log(
    `[worker] filling ${jobs.length} missing meal(s) across ${new Set(jobs.map((j) => j.day.day)).size} day(s)`
  );

  await Promise.all(
    jobs.map(async ({ day, plan, meal }) => {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: REPAIR_MAX_TOKENS,
          system: MEAL_REPAIR_SYSTEM,
          output_config: { effort: EXTRACT_EFFORT },
          messages: [
            {
              role: "user",
              content:
                `City: ${plan.city || brief.destinations[0]}\n` +
                `Date: ${day.date}\n` +
                `Meal to add: ${meal}\n` +
                `Day theme: ${plan.theme}\n` +
                `What the day already has: ${
                  day.items.map((i) => `${i.time} ${i.title}`).join(" | ") || "(nothing)"
                }\n` +
                `Party: ${brief.party_size} (${brief.party_composition})\n` +
                `Dietary constraints: ${brief.dietary_constraints.join(", ") || "none"}\n` +
                `Language: write time, title and reasoning in the same language as the items above.\n` +
                `Already used in this trip, do NOT reuse any of these: ${[...taken].join("; ")}`,
            },
          ],
        });
        onUsage?.(response.usage);
        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
        const parsed = JSON.parse(extractJson(textBlocks[textBlocks.length - 1]?.text ?? "")) as {
          time?: string;
          title?: string;
          venue_name?: string | null;
          location?: string;
          cost_estimate_eur?: number;
          reasoning?: string;
        };
        if (!parsed.venue_name || !parsed.title) return;
        if (taken.has(parsed.venue_name.toLowerCase())) return;
        taken.add(parsed.venue_name.toLowerCase());
        const added: ItineraryItem = {
          // The time is checked against the slot it was asked to fill, not
          // taken on trust. A dinner returned at 13:00 reads as a second
          // lunch to everything downstream — including the gate — so the
          // day would still be short a dinner and the repair would have
          // spent a call to achieve nothing. The venue is the part worth
          // asking a model for; which end of the day it goes at is
          // arithmetic, so it's enforced here.
          time: timeForSlot(parsed.time, meal),
          type: "meal",
          title: parsed.title,
          venue_name: parsed.venue_name,
          location: parsed.location || plan.city,
          cost_estimate_eur: typeof parsed.cost_estimate_eur === "number" ? parsed.cost_estimate_eur : 0,
          reasoning: parsed.reasoning || "",
          // Not searched and not yet through Places — checkVenues runs after
          // this and will verify it like any other named venue.
          source_confidence: "inferred",
          source_urls: [],
        };
        day.items.push(added);
        repaired?.push(added);
      } catch (e) {
        // A day that's still missing a meal is worse than one that has it,
        // but far better than a failed generation.
        console.error(`[worker] meal repair failed for day ${day.day} ${meal}:`, e);
      }
    })
  );

  // Items were appended, so each touched day is re-sorted into real clock
  // order rather than leaving lunch printed after the accommodation.
  for (const day of new Set(jobs.map((j) => j.day))) {
    day.items.sort((a, b) => timeOrder(a.time) - timeOrder(b.time));
  }
}

const DEFAULT_MEAL_TIME: Record<MealSlot, string> = {
  breakfast: "08:30",
  lunch: "13:00",
  dinner: "19:30",
};

/** Keeps a repaired meal in the slot it was meant to fill. Accepts the
 * model's own time when it genuinely lands in that slot — it often knows
 * that a particular place is better at 20:30 than 19:30 — and substitutes
 * the slot's default when it doesn't. */
function timeForSlot(proposed: string | undefined, slot: MealSlot): string {
  if (proposed) {
    const asItem = { time: proposed, title: "" } as ItineraryItem;
    if (mealSlotOf(asItem) === slot) return proposed;
  }
  return DEFAULT_MEAL_TIME[slot];
}

/** Rough sort key for an item's time, used only to place repaired items
 * sensibly among existing ones. Unparseable times keep their relative
 * position by sorting to the end of the day rather than to the front, where
 * an unknown would displace a real breakfast. */
function timeOrder(time: string | undefined): number {
  if (!time) return 24;
  const m = /(\d{1,2})[:.](\d{2})/.exec(time);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const t = time.toLowerCase();
  // "afternoon" before "noon" — see scheduledMinutes in
  // engine/venueVerification.ts for why that ordering is load-bearing.
  if (/morning|breakfast|закуск/.test(t)) return 8.5;
  if (/afternoon|следобед/.test(t)) return 15.5;
  if (/midday|\bnoon\b|lunch|об[яе]д/.test(t)) return 13;
  if (/evening|dinner|вечер/.test(t)) return 19.5;
  if (/night|нощ/.test(t)) return 22;
  return 24;
}

/** Phase 1: the whole-trip decisions and the day layout, as two calls that
 * run at the same time. They own disjoint fields and neither reads the
 * other's output, so this costs max(frame, plan) where it used to cost
 * their sum — see the header comment in engine/twoPhase.ts. */
async function generateSkeleton(
  client: Anthropic,
  brief: TripBriefInput,
  cachedLodgingFacts: Record<string, string>,
  onUsage?: (usage: ModelUsage) => void
): Promise<TripSkeleton> {
  const [frame, plan] = await Promise.all([
    withOneRetryOf(() =>
      generatePhase1Half<TripFrame>(
        client,
        "trip frame",
        getFrameSystemPrompt(),
        buildFramePrompt(brief, cachedLodgingFacts),
        isUsableFrame,
        onUsage
      )
    ),
    withOneRetryOf(() =>
      generatePhase1Half<TripPlan>(
        client,
        "day plan",
        getPlanSystemPrompt(),
        buildPlanPrompt(brief),
        isUsablePlan,
        onUsage
      )
    ),
  ]);
  return mergeSkeleton(frame, plan);
}

/** Skeleton, then all days concurrently. Throws on any failure so the
 * caller can fall back to the single-call path — a partially-written
 * itinerary must never reach a traveler just because it was faster. */
async function generateItineraryTwoPhase(
  client: Anthropic,
  brief: TripBriefInput,
  cachedLodgingFacts: Record<string, string>,
  onUsage?: (usage: ModelUsage) => void,
  onPhaseTimings?: (t: {
    skeletonMs: number;
    daysMs: number;
    dayCount: number;
    dayWaves: number;
  }) => void,
  // Hands the day plan back out so the post-generation checks can compare
  // what was written against what was planned — specifically, which meals
  // each day was supposed to have. Only the parallel path produces one; the
  // single-call fallback has no plan to check against, which is a real (and
  // acceptable) gap in the rare case it runs.
  onPlan?: (days: SkeletonDay[]) => void,
  // Lodging lookups already in flight, started at t=0 alongside this call
  // rather than before it. Awaited between the two phases: phase 1 doesn't
  // need them (it can price accommodation from general knowledge and be
  // corrected), phase 2 does (it writes the actual accommodation items), so
  // this is exactly where a whole serial stage can be folded into one that
  // was already running.
  pendingLodging?: Promise<{ city: string; result: LodgingLookupResult | null }[]>
): Promise<Itinerary> {
  // No retry wrapper here: each half of phase 1 retries itself, and a
  // second layer on top would quietly turn one bad response into four
  // calls.
  const startedAt = Date.now();
  const skeleton = await generateSkeleton(client, brief, cachedLodgingFacts, onUsage);
  const skeletonMs = Date.now() - startedAt;
  onPlan?.(skeleton.days);

  for (const { city, result } of (await pendingLodging) ?? []) {
    if (!result) continue;
    applyVerifiedAccommodation(skeleton, city, {
      costPerNightEur: result.costEstimateEur,
      name: result.name,
      area: result.area,
      sourceUrls: result.sourceUrl ? [result.sourceUrl] : [],
    });
  }

  const daysStartedAt = Date.now();
  const days = await runWithLimit(skeleton.days, MAX_PARALLEL_DAYS, (day) =>
    withRateLimitRetry(`day ${day.day}`, () =>
      withOneRetryOf(() => generateDay(client, brief, skeleton, day, onUsage))
    )
  );
  const daysMs = Date.now() - daysStartedAt;
  const waves = Math.ceil(days.length / MAX_PARALLEL_DAYS);
  onPhaseTimings?.({ skeletonMs, daysMs, dayCount: days.length, dayWaves: waves });
  console.log(
    `[worker] phase 1 (frame ‖ plan) ${skeletonMs}ms, ${days.length} day(s) in ${daysMs}ms ` +
      `(<=${MAX_PARALLEL_DAYS} at a time = ${waves} wave(s), day model ${DAY_MODEL})`
  );

  return assembleItinerary(skeleton, days);
}

/** The original single-call path: one model call emits the entire
 * itinerary. Still the correctness backstop the two-phase path falls back
 * to, and still what runs when TWO_PHASE_GENERATION=0. */
function generateItinerarySingleCall(
  client: Anthropic,
  brief: TripBriefInput,
  cachedLodgingFacts: Record<string, string>,
  onUsage?: (usage: ModelUsage) => void,
  forceSkipSearch = false
): Promise<Itinerary> {
  // Skip the web_search tool entirely — not just instruct around it — when
  // every destination already has a cached, recently-verified lodging price
  // (lodging is the only thing ever searched now), so a repeat/common-
  // destination generation pays zero search latency rather than relying on
  // the model choosing not to search.
  //
  // This used to be forced on for test-mode jobs as well, which made the
  // owner's own generations quietly WEAKER than a real traveler's — the
  // one person who needs to see the true output was the only one who
  // couldn't. Test mode now bypasses the guardrails only (see jobs.ts).
  const skipSearch = forceSkipSearch || brief.destinations.every((d) => d in cachedLodgingFacts);
  return withOneRetry(() =>
    callModel(client, brief, buildPrompt(brief, cachedLodgingFacts), onUsage, skipSearch)
  );
}

async function generateItinerary(
  client: Anthropic,
  brief: TripBriefInput,
  cachedLodgingFacts: Record<string, string>,
  onUsage?: (usage: ModelUsage) => void,
  forceSkipSearch = false,
  timings?: JobTimings,
  pendingLodging?: Promise<{ city: string; result: LodgingLookupResult | null }[]>,
  onPlan?: (days: SkeletonDay[]) => void
): Promise<Itinerary> {
  if (TWO_PHASE_ENABLED) {
    try {
      return await generateItineraryTwoPhase(
        client,
        brief,
        cachedLodgingFacts,
        onUsage,
        (t) => {
          if (timings) {
            timings.skeletonMs = t.skeletonMs;
            timings.daysMs = t.daysMs;
            timings.dayCount = t.dayCount;
            timings.dayWaves = t.dayWaves;
          }
        },
        onPlan,
        pendingLodging
      );
    } catch (e) {
      if (timings) {
        timings.fellBackToSingleCall = true;
        timings.fallbackReason = e instanceof Error ? e.message : String(e);
      }
      // Deliberately broad: whatever went wrong in the fast path (malformed
      // skeleton twice over, a day that wouldn't parse, a provider hiccup
      // mid-fan-out), the traveler should still get a real itinerary rather
      // than an error. Costs a slow generation in the rare failure case,
      // which is strictly better than failing one. Auth/rate-limit errors
      // will simply fail again below and surface normally.
      console.error("[worker] two-phase generation failed, falling back to single-call:", e);
    }
  }
  return generateItinerarySingleCall(client, brief, cachedLodgingFacts, onUsage, forceSkipSearch);
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

export async function processJob(redis: Redis, client: Anthropic, id: string): Promise<void> {
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

  // Stage timings, logged as one line at the end of every job. Generation
  // latency has been tuned three separate times against reasoning about
  // which stage "should" dominate rather than a measurement of which one
  // actually does — this makes the next round (and any regression) a
  // matter of reading a log line instead of re-deriving it from the code.
  const jobStartedAt = Date.now();
  const timings: Record<string, number> = {};
  const jobTimings: JobTimings = { totalMs: 0 };
  async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      timings[label] = (timings[label] ?? 0) + (Date.now() - t0);
    }
  }

  // Hoisted above the refinement branch so the tail can await it either
  // way; a refinement re-runs flight pricing too.
  const pendingFare = fetchFarePricing(job.brief).catch(() => null);

  // What phase 1 planned each day to contain, captured so the checks below
  // can hold the written days to it. Stays empty for a refinement and for
  // the single-call fallback, which produce no plan.
  let planDays: SkeletonDay[] = [];

  try {
    let itinerary: Itinerary;
    if (job.refinement) {
      itinerary = await timed("refine", () =>
        generateRefinement(client, job.brief, job.refinement!, onUsage)
      );
    } else {
      const cachedLodgingFacts = await loadCachedLodgingFacts(redis, job.brief.destinations);

      // Anything already cached is free and phase 1 gets it immediately.
      // Anything missing needs live searches, and those used to run BEFORE
      // generation started — a serial stage on the critical path that phase
      // 1 doesn't actually depend on. It now runs concurrently with phase 1
      // and is folded in before phase 2, which is the point at which the
      // itinerary genuinely needs it. Cache hits behave exactly as before.
      const missing = job.brief.destinations.filter((d) => !(d in cachedLodgingFacts));
      const lodgingStartedAt = Date.now();
      const pendingLodging =
        missing.length > 0
          ? Promise.all(
              missing.map(async (city) => ({ city, result: await prefetchLodging(client, city, onUsage) }))
            ).then(async (results) => {
              timings.lodgingPrefetch = Date.now() - lodgingStartedAt;
              await Promise.all(
                results.map(({ city, result }) =>
                  // Only a result with a real PRICE is worth caching — the
                  // cache's whole job is to let a later generation skip the
                  // rate search, and an entry with no rate in it would just
                  // suppress that search while supplying nothing.
                  result && result.costEstimateEur != null && result.sourceUrl
                    ? writeCachedLodgingFact(redis, city, {
                        costEstimateEur: result.costEstimateEur,
                        sourceUrls: [result.sourceUrl],
                        sourceAgreement: null,
                        name: result.name ?? undefined,
                        area: result.area ?? undefined,
                      })
                    : Promise.resolve()
                )
              );
              return results;
            })
          : undefined;

      itinerary = await timed("generate", () =>
        generateItinerary(
          client,
          job.brief,
          cachedLodgingFacts,
          onUsage,
          false,
          jobTimings,
          pendingLodging,
          (days) => {
            planDays = days;
          }
        )
      );
    }
    // VERIFY FIRST, THEN REPAIR. This order is the fix for a hole that had
    // been open the whole time and is invisible from either end on its own.
    //
    // checkVenues doesn't flag a venue it can't confirm, it DELETES the
    // item. So a restaurant that fails its Places lookup — a wrong listing,
    // a sub-4.2 rating, or now, shut on the day we're sending them — took
    // the day's dinner with it. Running the repairs before that, as they
    // were, meant they could only ever fix holes the MODEL left. A hole
    // punched by verification a moment later was nobody's job, and the day
    // simply went out one meal short.
    //
    // That explains a real trip coming back with days that had no lunch and
    // no dinner far better than the model forgetting to write them, and it
    // would have survived every prompt fix aimed at the model.
    //
    // attachFlightSearchLinks must run before applyFlightPricing — the
    // price lookup reuses the same link as its source_urls value once a
    // real fare is found.
    itinerary = attachFlightSearchLinks(itinerary, job.brief);
    itinerary = await timed("verify", async () => {
      // The Amadeus round-trips already happened concurrently with
      // generation; applying them is pure bookkeeping, so only the Places
      // verification actually costs anything here.
      const [verified, fare] = await Promise.all([checkVenues(itinerary), pendingFare]);
      return applyFlightPricing(verified, job.brief, fare, (obs) => {
        void recordFareObservation(redis, obs);
      });
    });

    // Now repair what's missing — whether the model never wrote it or
    // verification just removed it. Both repairs run in ONE stage: they
    // touch different problems and neither reads the other's output, so
    // serializing them would add a whole round-trip to every generation
    // that needs both.
    const claimedVenues = new Set<string>();
    for (const day of itinerary.days ?? []) {
      for (const item of day.items) {
        if (item.venue_name) claimedVenues.add(item.venue_name.toLowerCase());
      }
    }
    const repaired: ItineraryItem[] = [];
    await timed("repairs", () =>
      Promise.all([
        repairDuplicateVenues(client, job.brief, itinerary, claimedVenues, onUsage, repaired),
        planDays.length > 0
          ? repairMissingMeals(client, job.brief, planDays, itinerary, claimedVenues, onUsage, repaired)
          : Promise.resolve(),
      ])
    );

    // Second verification pass over ONLY what the repairs touched. A
    // replacement venue is a fresh, unchecked business, and shipping it
    // unverified would undo the guarantee the first pass exists to make —
    // but re-checking the whole trip would spend a Places lookup per item
    // to reconfirm what was confirmed a moment ago. Typically a handful of
    // items, all in parallel.
    if (repaired.length > 0) {
      itinerary = await timed("verifyRepairs", () =>
        checkVenues(itinerary, { only: new Set(repaired) })
      );
    }

    itinerary = checkFeasibility(itinerary);
    itinerary = checkBudgetIntegrity(itinerary, job.brief);
    itinerary = deriveConfidenceTiers(itinerary);

    // The acceptance gate, run LAST — after the repairs have had their
    // turn, after Places has verified what it can, after the confidence
    // tiers are derived. Everything upstream gets to do its job first;
    // this is the verdict on the result of all of it.
    //
    // It does not block the job. An itinerary with a defect still ships,
    // because a traveler waiting on a generation is better served by a
    // flawed itinerary than by an error page, and every defect it can
    // catch it has already tried to repair. What it changes is that the
    // flaw is now RECORDED — on this job, and in the rolling quality
    // counters — instead of waiting to be noticed in a screenshot.
    const quality = assessQuality(itinerary, job.brief, planDays);
    job.quality = quality;
    console.log(`[worker] quality ${id}: ${summarizeQuality(quality)}`);
    void recordQualitySample(redis, quality);

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

  jobTimings.totalMs = Date.now() - jobStartedAt;
  jobTimings.lodgingPrefetchMs = timings.lodgingPrefetch;
  jobTimings.generateMs = timings.generate;
  jobTimings.repairsMs = timings.repairs;
  jobTimings.venuesAndFlightsMs = timings.verify;
  jobTimings.verifyRepairsMs = timings.verifyRepairs;
  job.timings = jobTimings;

  await recordSpend(redis, costUsd);
  await writeJob(redis, job);
  const breakdown = Object.entries(timings)
    .map(([label, ms]) => `${label} ${(ms / 1000).toFixed(1)}s`)
    .join(", ");
  console.log(
    `[worker] finished ${id}: ${job.status} in ${((Date.now() - jobStartedAt) / 1000).toFixed(1)}s` +
      `${breakdown ? ` (${breakdown})` : ""}${costUsd > 0 ? ` ~$${costUsd.toFixed(4)}` : ""}`
  );
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

// Guarded so a test harness can import processJob without the consumer
// loop starting and blocking on Redis (see pipeline.test.ts).
if (process.env.WORKER_NO_AUTOSTART !== "1") {
  main().catch((e) => {
    console.error("[worker] fatal error:", e);
    process.exit(1);
  });
}
