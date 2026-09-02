// Accumulates a price history of our own, one observation at a time.
//
// This exists because real "should I buy now or wait?" is not a prompting
// problem - it needs historical prices for the specific route, and no model
// can supply those. The codebase already paid for that lesson once: see the
// header of engine/flightPricing.ts, where a confident "€150, likely with
// one connection" guess turned out to be a real €43 nonstop, which is why
// model-guessed fares stopped being displayed as numbers at all.
//
// Third-party price metrics (see fetchPriceMetrics) answer "is this cheap
// for this route" today, but their coverage is partial and they're someone
// else's dataset. Every generation with an origin already fetches one real,
// timestamped market fare - recording those costs one Redis write and, over
// months, produces something no prompt can substitute for and no competitor
// has: our own price curves for the routes our travellers actually fly.
//
// Deliberately write-only for now. Nothing reads this yet, and that's the
// point - the data has to exist before any feature can stand on it, and
// starting to collect late is the one mistake that can't be undone later.

import type Redis from "ioredis";
import type { FareObservation } from "./engine/flightPricing";

// Long enough to cover a full booking curve (fares are commonly observable
// ~a year out) plus room to look back across a completed season. Not
// permanent: this is a cache-grade store on a Redis instance shared with
// jobs and rate limits, not an analytics warehouse. If this data ever
// becomes load-bearing it wants exporting somewhere durable first.
const FARE_HISTORY_TTL_SECONDS = 60 * 60 * 24 * 400;

// Caps a single route/date's series. One observation per generation means a
// popular route accrues slowly, and the shape of a booking curve is
// preserved fine at this resolution.
const MAX_OBSERVATIONS_PER_ROUTE_DATE = 200;

/** One key per route AND departure date: the useful signal is how a
 * specific date's fare moves as it approaches, not a blended average across
 * every date on the route. */
function fareHistoryKey(originCode: string, destinationCode: string, departureDate: string): string {
  return `fare-history:${originCode.toUpperCase()}-${destinationCode.toUpperCase()}:${departureDate}`;
}

/** Appends one observation. Best-effort and non-throwing, on the same
 * contract as every other side-channel in the worker (analytics, lodging
 * cache): collecting data must never be able to fail a generation the
 * traveller is waiting on. */
export async function recordFareObservation(redis: Redis, obs: FareObservation): Promise<void> {
  try {
    const key = fareHistoryKey(obs.originCode, obs.destinationCode, obs.departureDate);
    // Short field names because this is a high-cardinality store that will
    // hold a lot of small records: p=price EUR, t=observed at (ms),
    // d=days before departure.
    const entry = JSON.stringify({ p: obs.fareEur, t: obs.observedAt, d: obs.daysBeforeDeparture });
    await redis.rpush(key, entry);
    await redis.ltrim(key, -MAX_OBSERVATIONS_PER_ROUTE_DATE, -1);
    await redis.expire(key, FARE_HISTORY_TTL_SECONDS);
  } catch (e) {
    console.warn("[fareHistory] failed to record observation:", e);
  }
}
