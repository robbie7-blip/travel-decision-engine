// Frontend-only (Upstash REST client) daily spend cap: a read-side check
// before enqueueing a job (checkDailyBudget), and a write-side counterpart
// for the one frontend route that calls Anthropic directly instead of going
// through the worker (recordSpend, used by /api/trip-questions — see that
// route for why it bypasses the job queue). The worker has its own
// recordSpend (worker/src/index.ts) for the ioredis client after each real
// generation call; this one writes to the exact same spendKey() from
// costBudget.ts, so both paths' costs are visible to the same shared cap —
// checkDailyBudget would otherwise be blind to trip-question spend, letting
// the two combine past DAILY_BUDGET_USD without either individually
// noticing. Same principle as checkRateLimit in ratelimit.ts: real Anthropic
// spend needs a shared, atomic counter, not just a per-IP request count.

import type { Redis } from "@upstash/redis";
import { DAILY_BUDGET_USD, SPEND_KEY_TTL_SECONDS, dayKey, spendKey } from "./costBudget";

export interface BudgetCheckResult {
  allowed: boolean;
  spentUsd: number;
  limitUsd: number;
}

export async function checkDailyBudget(redis: Redis): Promise<BudgetCheckResult> {
  const spentUsd = (await redis.get<number>(spendKey(dayKey()))) ?? 0;
  return { allowed: spentUsd < DAILY_BUDGET_USD, spentUsd, limitUsd: DAILY_BUDGET_USD };
}

/** Adds a request's estimated cost onto today's running total. Deliberately
 * doesn't duplicate the worker's budget-threshold webhook alert (see
 * maybeAlertBudgetThreshold in worker/src/index.ts) — trip-question calls
 * are far cheaper than a full generation, so the worker's alert, fired from
 * the dominant spend source, is early-enough warning on its own. */
export async function recordSpend(redis: Redis, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const key = spendKey();
  await redis.incrbyfloat(key, costUsd);
  await redis.expire(key, SPEND_KEY_TTL_SECONDS);
}
