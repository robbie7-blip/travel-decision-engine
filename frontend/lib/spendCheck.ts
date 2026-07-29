// Frontend-only (Upstash REST client) check against the daily spend cap —
// the counterpart write happens in the worker (see recordSpend in
// worker/src/index.ts) after each real model call, using the same
// spendKey() from costBudget.ts. Checked before enqueueing a job, same
// principle as checkRateLimit in ratelimit.ts: a generation costs real
// Anthropic spend once the worker picks it up, and per-IP request-count
// limits alone don't protect against many distinct IPs each individually
// staying under their own cap while collectively running past the
// intended daily budget.

import type { Redis } from "@upstash/redis";
import { DAILY_BUDGET_USD, dayKey, spendKey } from "./costBudget";

export interface BudgetCheckResult {
  allowed: boolean;
  spentUsd: number;
  limitUsd: number;
}

export async function checkDailyBudget(redis: Redis): Promise<BudgetCheckResult> {
  const spentUsd = (await redis.get<number>(spendKey(dayKey()))) ?? 0;
  return { allowed: spentUsd < DAILY_BUDGET_USD, spentUsd, limitUsd: DAILY_BUDGET_USD };
}
