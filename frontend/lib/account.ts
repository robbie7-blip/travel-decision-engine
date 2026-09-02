// Redis-backed user + subscription records - no new database, same Upstash
// instance everything else already uses. A "user" only exists once an email
// has either requested a magic link or completed Stripe checkout; there's no
// separate signup step.
//
// Quota model: signing in swaps a client OFF the anonymous per-IP abuse
// limiter (see ratelimit.ts) and ONTO a per-email monthly generation count,
// sized by plan - this is the actual product tier, not just an abuse guard.
// FREE_MONTHLY_GENERATIONS and PAID_MONTHLY_GENERATIONS are starting
// numbers, deliberately env-overridable: tune them against real cost data
// (see costBudget.ts) once there's usage to look at.

import type { Redis } from "@upstash/redis";
import { FREE_MONTHLY_GENERATIONS, PAID_MONTHLY_GENERATIONS } from "./planLimits";

export { FREE_MONTHLY_GENERATIONS, PAID_MONTHLY_GENERATIONS };

export type Plan = "free" | "paid";

export interface UserRecord {
  email: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  // Mirrors Stripe's own subscription.status values directly (active,
  // past_due, canceled, unpaid, incomplete, ...) rather than inventing a
  // parallel vocabulary - see isPaidStatus below for which ones count as
  // "still has access."
  subscriptionStatus: string | null;
  currentPeriodEnd: number | null; // epoch seconds
}

function userKey(email: string): string {
  return `user:${email.toLowerCase().trim()}`;
}

function stripeCustomerKey(customerId: string): string {
  return `stripeCustomer:${customerId}`;
}

/** Stripe's subscription/invoice webhook events carry a customer ID, not an
 * email - this reverse index (written once at checkout.session.completed)
 * is how customer.subscription.updated/deleted later find the right
 * user:<email> record to update. */
export async function linkStripeCustomerToEmail(redis: Redis, customerId: string, email: string): Promise<void> {
  await redis.set(stripeCustomerKey(customerId), email.toLowerCase().trim());
}

export async function getEmailForStripeCustomer(redis: Redis, customerId: string): Promise<string | null> {
  return (await redis.get<string>(stripeCustomerKey(customerId))) ?? null;
}

function monthKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7); // YYYY-MM, UTC
}

function quotaKey(email: string, month: string): string {
  return `quota:${email.toLowerCase().trim()}:${month}`;
}

// A canceled/past-due subscription still shows on the account until Stripe
// actually revokes it, but only these statuses should grant paid quota -
// "past_due" keeps access during Stripe's own retry/grace window (its
// default Smart Retries schedule), everything past that (canceled, unpaid,
// incomplete_expired) falls back to free.
const PAID_ACCESS_STATUSES = new Set(["active", "past_due"]);

export function isPaidStatus(status: string | null): boolean {
  return status != null && PAID_ACCESS_STATUSES.has(status);
}

// Lets the site owner (and anyone else added here) use Pro features on
// their own account without an actual Stripe subscription behind it -
// dogfooding decide, or just testing Ask a Local's web_search gating,
// shouldn't require paying yourself €9/month. Comma-separated env var
// (unset = nobody, same "off by default" shape as ADMIN_PASSWORD) rather
// than a hardcoded email, so the allowlist is a Vercel dashboard edit, not
// a code change + redeploy. This only ever widens free->paid for the
// emails listed - never narrows a real paying customer's access, and
// never grants a stripeCustomerId, so billing-portal correctly has
// nothing to manage for an override-only account (see account/page.tsx's
// hasStripeSubscription check).
const PRO_OVERRIDE_EMAILS = new Set(
  (process.env.PRO_OVERRIDE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

/** The plan every route should actually gate features on - layers the
 * owner override on top of isPaidStatus rather than each call site
 * checking both separately. */
export function resolvePlan(email: string, subscriptionStatus: string | null): Plan {
  if (PRO_OVERRIDE_EMAILS.has(email.toLowerCase().trim())) return "paid";
  return isPaidStatus(subscriptionStatus) ? "paid" : "free";
}

export async function getUserRecord(redis: Redis, email: string): Promise<UserRecord | null> {
  const data = await redis.hgetall<Record<string, string>>(userKey(email));
  if (!data || Object.keys(data).length === 0) return null;
  return {
    email: email.toLowerCase().trim(),
    stripeCustomerId: data.stripeCustomerId ?? null,
    stripeSubscriptionId: data.stripeSubscriptionId ?? null,
    subscriptionStatus: data.subscriptionStatus ?? null,
    currentPeriodEnd: data.currentPeriodEnd ? Number(data.currentPeriodEnd) : null,
  };
}

/** Merges fields into a user's record (creates it if it doesn't exist yet).
 * Used by the Stripe webhook and the checkout route - never by anything
 * client-controlled, since this is what grants paid access. */
export async function upsertUserRecord(
  redis: Redis,
  email: string,
  fields: Partial<Omit<UserRecord, "email">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const flat: Record<string, string> = {};
  for (const [k, v] of entries) {
    flat[k] = v === null ? "" : String(v);
  }
  await redis.hset(userKey(email), flat);
}

export interface QuotaResult {
  allowed: boolean;
  plan: Plan;
  limit: number;
  used: number;
}

/** Checks this month's usage against the caller's plan limit WITHOUT
 * consuming a slot - used to decide whether to even attempt the increment,
 * and to show remaining quota in the account UI. */
export async function getQuotaStatus(redis: Redis, email: string, plan: Plan): Promise<QuotaResult> {
  const limit = plan === "paid" ? PAID_MONTHLY_GENERATIONS : FREE_MONTHLY_GENERATIONS;
  const used = (await redis.get<number>(quotaKey(email, monthKey()))) ?? 0;
  return { allowed: used < limit, plan, limit, used };
}

// ~40 days: comfortably outlives the calendar month the key is scoped to
// (handles a request landing right at a month boundary) without keeping
// stale counters forever.
const QUOTA_KEY_TTL_SECONDS = 60 * 60 * 24 * 40;

/** Records one generation against this month's count. Called only after
 * getQuotaStatus already confirmed room - this is a plain increment, not a
 * check-and-increment, so it accepts the same small race-condition
 * tolerance as the existing daily spend cap (spendCheck.ts) rather than
 * reaching for Redis transactions at this scale. */
export async function consumeQuota(redis: Redis, email: string): Promise<void> {
  const key = quotaKey(email, monthKey());
  await redis.incr(key);
  await redis.expire(key, QUOTA_KEY_TTL_SECONDS);
}
