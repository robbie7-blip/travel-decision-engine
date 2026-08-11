// Self-hosted usage counters — no third-party script, no cookies, just a
// handful of Redis counters incremented on each successful job enqueue.
// Deliberately minimal (totals + per-language + per-day), consistent with
// this codebase's preference for small hand-rolled pieces over pulling in
// a analytics SDK for something this size. Surfaced on the
// password-protected /admin/stats page.

import type { Redis } from "@upstash/redis";
import type { Language } from "./types";

export type AnalyticsEventType = "generate" | "refine";

const LANGUAGES: Language[] = ["en", "bg"];

function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

const totalKey = (type: AnalyticsEventType) => `analytics:${type}:total`;
const langKey = (type: AnalyticsEventType, lang: Language) => `analytics:${type}:lang:${lang}`;
const dayCountKey = (type: AnalyticsEventType, day: string) => `analytics:${type}:day:${day}`;
const DAYS_SEEN_KEY = "analytics:days"; // set of every day-key we've ever written, so the stats page knows what to look up

/** Fire this after a job is successfully enqueued (not before rate-limit
 * checks pass, and not on validation failures — this counts real attempted
 * usage, not every malformed request). Best-effort: analytics must never
 * break the actual feature, so failures here are swallowed by the caller. */
export async function recordEvent(redis: Redis, type: AnalyticsEventType, language: Language): Promise<void> {
  const day = dayKey();
  await Promise.all([
    redis.incr(totalKey(type)),
    redis.incr(langKey(type, language)),
    redis.incr(dayCountKey(type, day)),
    redis.sadd(DAYS_SEEN_KEY, day),
  ]);
}

// Conversion-funnel counters — separate from the generate/refine tracking
// above (own key namespace, own recording function) rather than folded
// into AnalyticsEventType, since these don't have a language dimension
// that makes sense for every one of them (a Stripe webhook event, for
// instance, carries no site-language context at all) where generate/refine
// always do. Totals only for now, no daily breakdown — this exists to
// answer "where do people actually drop off" at all, which zero visibility
// couldn't answer; a day-by-day view is a natural next step once these
// totals turn up something worth digging into.
export type FunnelEventType =
  | "pricing_view"
  | "checkout_started"
  | "checkout_completed"
  | "subscription_canceled"
  | "quota_blocked_free"
  | "quota_blocked_paid";

const FUNNEL_EVENT_TYPES: FunnelEventType[] = [
  "pricing_view",
  "checkout_started",
  "checkout_completed",
  "subscription_canceled",
  "quota_blocked_free",
  "quota_blocked_paid",
];

const funnelTotalKey = (type: FunnelEventType) => `analytics:funnel:${type}:total`;

/** Same "best-effort, never breaks the real feature" contract as
 * recordEvent above — every call site swallows failures from this. */
export async function recordFunnelEvent(redis: Redis, type: FunnelEventType): Promise<void> {
  await redis.incr(funnelTotalKey(type));
}

export type FunnelSnapshot = Record<FunnelEventType, number>;

export async function loadFunnelSnapshot(redis: Redis): Promise<FunnelSnapshot> {
  const counts = await Promise.all(FUNNEL_EVENT_TYPES.map((type) => redis.get<number>(funnelTotalKey(type))));
  return Object.fromEntries(FUNNEL_EVENT_TYPES.map((type, i) => [type, counts[i] ?? 0])) as FunnelSnapshot;
}

export interface DailyCount {
  day: string;
  generate: number;
  refine: number;
}

export interface AnalyticsSnapshot {
  generateTotal: number;
  refineTotal: number;
  generateByLang: Record<Language, number>;
  refineByLang: Record<Language, number>;
  daily: DailyCount[]; // most recent `dayLimit` days that have any data, oldest first
}

export async function loadAnalyticsSnapshot(redis: Redis, dayLimit = 14): Promise<AnalyticsSnapshot> {
  const [generateTotal, refineTotal, genByLang, refByLang, days] = await Promise.all([
    redis.get<number>(totalKey("generate")),
    redis.get<number>(totalKey("refine")),
    Promise.all(LANGUAGES.map((lang) => redis.get<number>(langKey("generate", lang)))),
    Promise.all(LANGUAGES.map((lang) => redis.get<number>(langKey("refine", lang)))),
    redis.smembers(DAYS_SEEN_KEY),
  ]);

  const recentDays = [...days].sort().slice(-dayLimit);
  const [genCounts, refCounts] = await Promise.all([
    Promise.all(recentDays.map((day) => redis.get<number>(dayCountKey("generate", day)))),
    Promise.all(recentDays.map((day) => redis.get<number>(dayCountKey("refine", day)))),
  ]);

  return {
    generateTotal: generateTotal ?? 0,
    refineTotal: refineTotal ?? 0,
    generateByLang: { en: genByLang[0] ?? 0, bg: genByLang[1] ?? 0 },
    refineByLang: { en: refByLang[0] ?? 0, bg: refByLang[1] ?? 0 },
    daily: recentDays.map((day, i) => ({ day, generate: genCounts[i] ?? 0, refine: refCounts[i] ?? 0 })),
  };
}
