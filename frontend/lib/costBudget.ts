// Shared cost-estimation + Redis key conventions for the daily spend cap.
// Imported by both the Next.js app (checks the day's running total before
// enqueueing a job - see spendCheck.ts, used by /api/generate and
// /api/refine) and the worker (the only place actual token usage from a
// completed model call is available, via response.usage - see callModel in
// index.ts). Deliberately has no Redis-client-specific imports (Upstash
// REST on the frontend vs. ioredis on the worker), so it stays portable
// like jobs.ts and types.ts - kept byte-identical between
// frontend/lib/costBudget.ts and worker/src/costBudget.ts.

// The rate for MODEL, which is Claude Sonnet 5. Overridable via env so a
// pricing change doesn't require a code edit.
//
// The comment here used to say this was "introductory pricing, in effect
// through 2026-08-31 (then reverts to $3.00 / $15.00 per MTok)". That date
// has passed, and checking the live pricing rather than trusting the note:
// Claude Sonnet 5 is $2 / $10 per MTok, with no introductory caveat. So the
// numbers were right and the warning was wrong - worth correcting, because
// a stale "this expires" comment is how a spend cap gets adjusted on a
// schedule nobody re-checked.
const DEFAULT_INPUT_COST_PER_MTOK_USD = 2.0;
const DEFAULT_OUTPUT_COST_PER_MTOK_USD = 10.0;

/** Per-model rates, for when a stage deliberately runs on a different
 * model from the rest of the pipeline.
 *
 * DAY_MODEL exists as a latency lever: phase 2 is mechanical enough that a
 * faster model is a real trade, and the obvious candidate is Claude Haiku
 * 4.5. But estimateCostUsd took only `usage` - one flat pair of rates for
 * every call in the job - so turning that dial would have priced every day
 * call's tokens at Sonnet's rate while they ran on Haiku's. Haiku 4.5 is
 * $1 / $5 against Sonnet 5's $2 / $10: EXACTLY half, on both halves. The
 * day calls are the bulk of a generation's output tokens (one per planned
 * day), so the day's spend counter would have read about twice the real
 * bill.
 *
 * Which is worse than merely inaccurate. checkDailyBudget blocks
 * generation at DAILY_BUDGET_USD, so an overstated counter trips the cap
 * early and stops real travellers; and it overstates in the direction that
 * makes the CHEAPER configuration look expensive, so the number meant to
 * justify the optimisation would have argued against it.
 *
 * Matched on substring rather than exact ID because every ID is a pinned
 * snapshot with an optional date suffix - "claude-haiku-4-5" and
 * "claude-haiku-4-5-20251001" are the same model and the same price. Rates
 * are per million tokens, input then output, from the published model
 * comparison. An unrecognised model falls back to the env-configured pair
 * above, which is the behaviour every call had before this table existed. */
const MODEL_RATES: { match: string; input: number; output: number }[] = [
  { match: "haiku-4-5", input: 1.0, output: 5.0 },
  { match: "sonnet-5", input: 2.0, output: 10.0 },
  { match: "sonnet-4-6", input: 3.0, output: 15.0 },
  { match: "opus-5", input: 5.0, output: 25.0 },
  { match: "opus-4-8", input: 5.0, output: 25.0 },
  { match: "opus-4-7", input: 5.0, output: 25.0 },
  { match: "opus-4-6", input: 5.0, output: 25.0 },
  { match: "fable-5", input: 10.0, output: 50.0 },
  { match: "mythos-5", input: 10.0, output: 50.0 },
];

/** The input/output rate for a model, or the configured default.
 *
 * Exported so a test can assert the table rather than infer it from a
 * cost, and so /admin can show what a stage is being billed at. */
export function ratesFor(model?: string | null): { input: number; output: number } {
  if (typeof model === "string") {
    const m = model.toLowerCase();
    for (const rate of MODEL_RATES) {
      if (m.includes(rate.match)) return { input: rate.input, output: rate.output };
    }
  }
  return { input: INPUT_COST_PER_MTOK_USD, output: OUTPUT_COST_PER_MTOK_USD };
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const INPUT_COST_PER_MTOK_USD = envFloat("INPUT_COST_PER_MTOK_USD", DEFAULT_INPUT_COST_PER_MTOK_USD);
export const OUTPUT_COST_PER_MTOK_USD = envFloat("OUTPUT_COST_PER_MTOK_USD", DEFAULT_OUTPUT_COST_PER_MTOK_USD);

// Generous default: the existing per-IP limits already cap any single
// client at 20 generations/day, so this exists to catch what those can't -
// many distinct IPs each individually staying under their own limit, but
// summing to more real spend than intended overall.
const DEFAULT_DAILY_BUDGET_USD = 25;
export const DAILY_BUDGET_USD = envFloat("DAILY_BUDGET_USD", DEFAULT_DAILY_BUDGET_USD);

// A day's spend key outlives the day itself by a comfortable margin so
// clock skew between the frontend and worker processes can't drop a write
// into an already-expired bucket - cheap insurance, not load-bearing.
export const SPEND_KEY_TTL_SECONDS = 60 * 60 * 24 * 3;

export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC - matches analytics.ts's dayKey
}

export function spendKey(day: string = dayKey()): string {
  return `spend:day:${day}`;
}

// Early-warning threshold: the worker logs (and optionally pings a webhook,
// see BUDGET_ALERT_WEBHOOK_URL in index.ts) once actual spend crosses this
// fraction of DAILY_BUDGET_USD, so a climb toward the cap is visible before
// generations actually start getting rejected. Not a stricter enforcement
// rule - checkDailyBudget still only blocks at 100%.
export const ALERT_THRESHOLD_RATIO = 0.8;

// Separate from spendKey so "have we already alerted today" is its own
// flag - set once (via SET NX, see index.ts) the first time a job's spend
// update crosses the threshold, so later jobs that same day don't re-alert.
export function alertKey(day: string = dayKey()): string {
  return `spend:alerted:${day}`;
}

// Cache write/read multipliers on the base input rate, per Anthropic's
// published prompt-caching pricing - a 5-minute-TTL write costs 1.25x the
// base input rate, a cache read costs 0.1x. The worker's system prompt now
// carries a `cache_control: { type: "ephemeral" }` breakpoint (see
// callModel in index.ts), so real jobs report nonzero cache_creation/
// cache_read token counts and this needs to be priced, not just
// input_tokens/output_tokens - undercounting it here would let real spend
// drift above DAILY_BUDGET_USD without the cap ever tripping.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// Server-side tools are billed PER REQUEST, in dollars, not in tokens at
// all - and none of it was being counted.
//
// Three places in this product declare the web_search tool: the
// accommodation lookup (worker/src/index.ts, max_uses 2, and it runs up to
// four calls per city once both halves and their retries are counted), the
// single-call generation path, and Ask a Local, which fires on every
// question any visitor asks. Every search each of them makes is a separate
// charge, and `usage.server_tool_use.web_search_requests` is where the API
// reports it. Nothing read that field.
//
// The size of the gap, from the one generation with a known total: $0.3562
// counted, against up to eight searches for a single-city trip at a cent
// each. Roughly a fifth of that run's real cost was invisible to the cap -
// which means the counter reaches DAILY_BUDGET_USD when real spend is
// closer to $31, and the cap whose entire job is to stop that never trips.
const DEFAULT_SERVER_TOOL_COST_PER_1K_USD = 10.0;
export const SERVER_TOOL_COST_PER_1K_USD = envFloat(
  "SERVER_TOOL_COST_PER_1K_USD",
  DEFAULT_SERVER_TOOL_COST_PER_1K_USD
);

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Per-request server-tool charges. Priced by the TOTAL of the counters
   * here rather than by web_search alone: web_search is the only server
   * tool this product declares today, so every other counter is zero and
   * summing them costs nothing - but if a future change adds web_fetch or
   * code execution, the charge lands in the counter instead of vanishing.
   * Erring toward counting is the right direction for a spend cap; a rate
   * that turns out to differ per tool is a number to correct, while a whole
   * tool nobody priced is the bug this replaces. */
  server_tool_use?: {
    web_search_requests?: number | null;
    web_fetch_requests?: number | null;
  } | null;
}

/** Estimated USD cost of one model call from its reported usage: plain
 * input/output tokens, cache write/read tokens (see the multipliers above),
 * and per-request server-tool charges. */
/** What one call cost.
 *
 * `model` is OPTIONAL and should be the model the API says served the
 * request (response.model), not the one that was asked for - that way a
 * provider-side fallback is priced as what actually ran. Omitting it keeps
 * the previous behaviour exactly: the env-configured default pair. */
export function estimateCostUsd(usage: ModelUsage, model?: string | null): number {
  const { input, output } = ratesFor(model);
  const serverToolRequests =
    (usage.server_tool_use?.web_search_requests ?? 0) + (usage.server_tool_use?.web_fetch_requests ?? 0);
  return (
    (usage.input_tokens / 1_000_000) * input +
    (usage.output_tokens / 1_000_000) * output +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * input * CACHE_WRITE_MULTIPLIER +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * input * CACHE_READ_MULTIPLIER +
    (serverToolRequests / 1000) * SERVER_TOOL_COST_PER_1K_USD
  );
}
