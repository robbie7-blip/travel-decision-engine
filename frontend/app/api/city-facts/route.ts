// "Did you know?" trivia for the loading screen — shown while a trip
// generates so the wait feels like it's teaching you something about the
// place rather than just spinning. Two sources, tried in order:
//   1. The curated facts/*.json base (loadFacts, same file the model itself
//      is grounded on) — used as-is when the destination is one of the
//      curated cities, so this reuses data we've already hand-verified.
//   2. Wikipedia's free REST summary API (no key, no signup — consistent
//      with Open-Meteo elsewhere in this app) for every other destination,
//      so every possible city has *something* rather than only the ~24
//      curated ones. The summary extract is split into sentences to get a
//      handful of independent facts instead of one big paragraph.
// Facts don't change meaningfully day to day, so results are cached in
// Redis per-city (not per-request-combo) with a long TTL — a much better
// cache hit rate than keying on the full destinations list the way
// /api/weather does, since individual cities repeat across many trips.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { loadFacts } from "@/lib/engine/prompt";

export const runtime = "nodejs";

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — facts are effectively static
const MAX_FACTS_PER_CITY = 6;
const MIN_SENTENCE_LENGTH = 25; // drops fragments ("She was born in 1990.") that read oddly alone

function cacheKey(city: string): string {
  return `city-facts:${city.trim().toLowerCase()}`;
}

function splitIntoFacts(extract: string): string[] {
  return extract
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LENGTH)
    .slice(0, MAX_FACTS_PER_CITY);
}

async function fetchWikipediaFacts(city: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { extract?: string; type?: string };
    if (!data.extract || data.type === "disambiguation") return [];
    return splitIntoFacts(data.extract);
  } catch {
    return [];
  }
}

async function factsForCity(city: string): Promise<string[]> {
  const curated = loadFacts(city);
  if (curated.length > 0) return curated.slice(0, MAX_FACTS_PER_CITY).map((f) => f.text);
  return fetchWikipediaFacts(city);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const destinations = (searchParams.get("destinations") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (destinations.length === 0) {
    return NextResponse.json({ facts: [] });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    redis = null;
  }

  const perCity = await Promise.all(
    destinations.map(async (city) => {
      if (redis) {
        const cached = await redis.get<string[] | string>(cacheKey(city));
        if (cached) return typeof cached === "string" ? (JSON.parse(cached) as string[]) : cached;
      }

      const facts = await factsForCity(city);
      if (redis && facts.length > 0) {
        await redis.set(cacheKey(city), JSON.stringify(facts), { ex: CACHE_TTL_SECONDS });
      }
      return facts;
    })
  );

  // Interleave rather than concatenate city-by-city, so a multi-city trip's
  // rotation doesn't spend its first minute stuck on just the first city.
  const facts: string[] = [];
  const maxLen = Math.max(0, ...perCity.map((f) => f.length));
  for (let i = 0; i < maxLen; i++) {
    for (const cityFacts of perCity) {
      if (cityFacts[i]) facts.push(cityFacts[i]);
    }
  }

  return NextResponse.json({ facts });
}
