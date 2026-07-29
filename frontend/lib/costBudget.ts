// Shared cost-estimation + Redis key conventions for the daily spend cap.
// Imported by both the Next.js app (checks the day's running total before
// enqueueing a job — see spendCheck.ts, used by /api/generate and
// /api/refine) and the worker (the only place actual token usage from a
// completed model call is available, via response.usage — see callModel in
// index.ts). Deliberately has no Redis-client-specific imports (Upstash
// REST on the frontend vs. ioredis on the worker), so it stays portable
// like jobs.ts and types.ts — kept byte-identical between
// frontend/lib/costBudget.ts and worker/src/costBudget.ts.

// Claude Sonnet 5 introductory pricing, in effect through 2026-08-31 (then
// reverts to $3.00 / $15.00 per MTok) — overridable via env so a pricing
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
// client at 20 generations/day, so this exists to catch what those can't —
// many distinct IPs each individually staying under their own limit, but
// summing to more real spend than intended overall.
const DEFAULT_DAILY_BUDGET_USD = 25;
export const DAILY_BUDGET_USD = envFloat("DAILY_BUDGET_USD", DEFAULT_DAILY_BUDGET_USD);

// A day's spend key outlives the day itself by a comfortable margin so
// clock skew between the frontend and worker processes can't drop a write
// into an already-expired bucket — cheap insurance, not load-bearing.
export const SPEND_KEY_TTL_SECONDS = 60 * 60 * 24 * 3;

export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC — matches analytics.ts's dayKey
}

export function spendKey(day: string = dayKey()): string {
  return `spend:day:${day}`;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
}

/** Estimated USD cost of one model call from its reported token usage.
 * Cache read/write tokens aren't priced by these two rates, but these
 * generation calls don't use prompt caching, so plain input/output pricing
 * is the whole story. */
export function estimateCostUsd(usage: ModelUsage): number {
  return (
    (usage.input_tokens / 1_000_000) * INPUT_COST_PER_MTOK_USD +
    (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK_USD
  );
}
