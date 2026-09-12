// Public, read-only: live EUR exchange rates for the currency switcher (see
// lib/currency.ts). Cached in Redis so a page full of visitors doesn't each
// trigger an upstream call - rates don't need to be more real-time than a
// few hours old for a trip-cost estimate anyway. Falls back to an empty
// rates object (EUR-only display) on any failure rather than serving a
// stale or fabricated conversion.

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { SUPPORTED_CURRENCIES, sanitizeRates, type FxRates } from "@/lib/currency";

export const runtime = "nodejs";

const RATES_KEY = "fx:rates:eur";
const CACHE_TTL_SECONDS = 60 * 60 * 12; // 12h

interface CachedRates {
  rates: FxRates["rates"];
  fetchedAt: number;
}

const EMPTY_RATES: FxRates = { base: "EUR", rates: {}, fetchedAt: null };

export async function GET() {
  let redis;
  try {
    redis = getRedis();
  } catch {
    redis = null;
  }

  // A cache hit is read defensively, because a bad value here is served for
  // up to twelve hours. JSON.parse on a truncated or hand-edited value threw
  // straight out of the route as a 500, and a cached object with no `rates`
  // key produced a response the client then crashed on (see formatMoney).
  // Anything unusable is treated as a miss, which costs one upstream call.
  if (redis) {
    try {
      const cached = await redis.get<string | CachedRates>(RATES_KEY);
      if (cached) {
        const parsed = typeof cached === "string" ? (JSON.parse(cached) as CachedRates) : cached;
        const rates = sanitizeRates(parsed?.rates);
        if (Object.keys(rates).length > 0) {
          const fetchedAt = typeof parsed?.fetchedAt === "number" ? parsed.fetchedAt : null;
          return NextResponse.json({ base: "EUR", rates, fetchedAt });
        }
      }
    } catch {
      // Fall through to a fresh fetch rather than 500 on a poisoned key.
    }
  }

  const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== "EUR").join(",");
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${symbols}`);
    if (!res.ok) throw new Error(`upstream returned ${res.status}`);

    // `as { rates: FxRates["rates"] }` was a type assertion over a network
    // payload, not a check - the same non-check test:shape exists to stop on
    // the worker side. A 200 whose body had no `rates` key cached
    // `rates: undefined`, JSON.stringify dropped the field, and every trip
    // page render threw inside formatMoney for the next twelve hours.
    const data = (await res.json()) as unknown;
    const rates = sanitizeRates((data as { rates?: unknown } | null)?.rates);

    // Never cache an empty result. Twelve hours of EUR-only display because
    // one upstream response was malformed is a far worse outcome than one
    // extra call per request until it recovers.
    if (Object.keys(rates).length === 0) {
      console.error("[rates] upstream returned no usable rates - not caching");
      return NextResponse.json(EMPTY_RATES);
    }

    const payload: CachedRates = { rates, fetchedAt: Date.now() };
    if (redis) {
      await redis.set(RATES_KEY, JSON.stringify(payload), { ex: CACHE_TTL_SECONDS });
    }
    return NextResponse.json({ base: "EUR", ...payload });
  } catch {
    return NextResponse.json(EMPTY_RATES);
  }
}
