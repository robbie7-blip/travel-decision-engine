// Shared cost-estimation + Redis key conventions for the daily spend cap.
// Imported by both the Next.js app (checks the day's running total before
// enqueueing a job - see spendCheck.ts, used by /api/generate and
// /api/refine) and the worker (the only place actual token usage from a
// completed model call is available, via response.usage - see callModel in
// index.ts). Deliberately has no Redis-client-specific imports (Upstash
// REST on the frontend vs. ioredis on the worker), so it stays portable
// like jobs.ts and types.ts - kept byte-identical between
// frontend/lib/costBudget.ts and worker/src/costBudget.ts.

// Claude Sonnet 5 introductory pricing, in effect through 2026-08-31 (then
// reverts to $3.00 / $15.00 per MTok) - overridable via env so a pricing
// change doesn't require a code edit.
const DEFAULT_INPUT_COST_PER_MTOK_USD = 2.0;
const DEFAULT_OUTPUT_COST_PER_MTOK_USD = 10.0;

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

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Estimated USD cost of one model call from its reported token usage,
 * including cache write/read tokens (see multipliers above) alongside
 * plain input/output pricing. */
export function estimateCostUsd(usage: ModelUsage): number {
  return (
    (usage.input_tokens / 1_000_000) * INPUT_COST_PER_MTOK_USD +
    (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK_USD +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * INPUT_COST_PER_MTOK_USD * CACHE_WRITE_MULTIPLIER +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * INPUT_COST_PER_MTOK_USD * CACHE_READ_MULTIPLIER
  );
}
