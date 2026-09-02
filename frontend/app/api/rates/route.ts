// Public, read-only: live EUR exchange rates for the currency switcher (see
// lib/currency.ts). Cached in Redis so a page full of visitors doesn't each
// trigger an upstream call - rates don't need to be more real-time than a
// few hours old for a trip-cost estimate anyway. Falls back to an empty
// rates object (EUR-only display) on any failure rather than serving a
// stale or fabricated conversion.

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { SUPPORTED_CURRENCIES, type FxRates } from "@/lib/currency";

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

  if (redis) {
    const cached = await redis.get<string | CachedRates>(RATES_KEY);
    if (cached) {
      const parsed = typeof cached === "string" ? (JSON.parse(cached) as CachedRates) : cached;
      return NextResponse.json({ base: "EUR", rates: parsed.rates, fetchedAt: parsed.fetchedAt });
    }
  }

  const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== "EUR").join(",");
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${symbols}`);
    if (!res.ok) throw new Error(`upstream returned ${res.status}`);
    const data = (await res.json()) as { rates: FxRates["rates"] };

    const payload: CachedRates = { rates: data.rates, fetchedAt: Date.now() };
    if (redis) {
      await redis.set(RATES_KEY, JSON.stringify(payload), { ex: CACHE_TTL_SECONDS });
    }
    return NextResponse.json({ base: "EUR", ...payload });
  } catch {
    return NextResponse.json(EMPTY_RATES);
  }
}
