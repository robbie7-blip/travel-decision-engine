// Real currency conversion for the structured cost figures decide already
// tracks as numbers (ItineraryItem.cost_estimate_eur, BudgetFeasibility.
// min_realistic_total_eur) - never for the free-text prose the model writes
// (trip_summary, budget_feasibility.reasoning, item.reasoning), which often
// embeds its own "€X" mentions inline. Regex-swapping currency symbols
// inside generated sentences risks a silently wrong number in a claim that
// looks authoritative - worse than just leaving that prose in EUR - so
// those stay untouched; only the structured fields convert.

import { usableCostEur } from "./engine/money";

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "BGN", "JPY", "CHF"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  BGN: "лв",
  JPY: "¥",
  CHF: "CHF ",
};

/** What a figure looks like when there isn't one.
 *
 * A plain hyphen, not a translated phrase, on purpose: it reads the same in
 * every language this app ships and needs no i18n key to stay in step with
 * the two it has. It appears where a price could not be read at all, which
 * is rare enough that the honest answer is "no number here" rather than a
 * sentence explaining why.
 *
 * A hyphen and not an em dash because check:dashes fails the build on one,
 * and that guard is right: "the em dash is the most recognisable tell that a
 * piece of text was written by a model, and this product asks travelers to
 * read its output as advice from a person." It caught this on its first run
 * after the change. */
export const NO_FIGURE = "-";

// Shared with the language preference's storage convention (see
// lib/i18n.ts's LANGUAGE_STORAGE_KEY) - one localStorage key, sticks across
// every page the same way.
export const CURRENCY_STORAGE_KEY = "decide:currency";

export interface FxRates {
  base: "EUR";
  // Only ever populated with rates actually returned by the upstream API
  // (see app/api/rates/route.ts) - a currency missing here means "no live
  // rate available right now", not "1:1".
  rates: Partial<Record<Currency, number>>;
  fetchedAt: number | null;
}

export function isSupportedCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Converts a stored EUR amount into the target currency and formats it with
 * the right symbol. Falls back to the raw EUR figure whenever the target
 * currency isn't EUR but no live rate is available for it (rates still
 * loading, upstream API down) - never fabricates a conversion. */
export function formatMoney(amountEur: number, currency: Currency, rates: FxRates | null): string {
  // The AMOUNT has to be a usable number too, not only the rate below.
  //
  // Every figure passed in here is model-written JSON that crossed Redis
  // under a type assertion - `cost_estimate_eur: number` is what types.ts
  // declares, not what was checked - and `Math.round` of a string prints
  // "€NaN" against a real currency symbol on a paid itinerary. A price the
  // model wrote as "15-20" did exactly that. Measured, not inferred.
  //
  // The worker coerces these at the shape gate now (engine/money.ts, whose
  // frontend copy this uses), so this is the backstop for the itineraries
  // ALREADY STORED, which no worker change can reach. It answers with the
  // same function the worker decides with, so a price one of them accepts
  // is not one the other prints as nonsense: "20" recovers to €20 as it
  // does today, and "15-20" - which cannot be recovered without inventing
  // an end of the range - shows NO_FIGURE rather than €NaN. Never €0, which
  // would be a claim that the thing is free.
  const amount = usableCostEur(amountEur);
  if (amount === null) return NO_FIGURE;
  if (currency === "EUR") return `€${Math.round(amount)}`;

  // `rates?.rates[currency]` - note where the optional chain stops. It
  // guarded the whole object being null and NOT the `rates` map inside it
  // being absent, so `undefined[currency]` threw a TypeError. The type says
  // that cannot happen; the type is an assertion on a JSON payload that
  // crosses a network boundary, which is not the same thing.
  //
  // It was reachable, and the blast radius was a blank page. /api/rates
  // cached whatever the upstream returned for twelve hours after a bare
  // `as { rates: ... }` cast: a body with no `rates` key cached
  // `rates: undefined`, JSON.stringify dropped the key, and every trip page
  // render threw here - for every visitor, for twelve hours, on itineraries
  // people had paid for. Exactly the shape test:result-format exists for
  // ("threw during render on a field nothing guarantees, blanking a
  // paid-for itinerary").
  const rate = rates?.rates?.[currency];

  // A rate has to be a usable number, not merely present. A string, a zero,
  // a negative or a NaN reaches Math.round(amountEur * rate) and prints
  // either nonsense or "NaN" against a real currency symbol, which is worse
  // than showing the honest EUR figure.
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return `€${Math.round(amount)}`;
  }

  return `${CURRENCY_SYMBOLS[currency]}${Math.round(amount * rate)}`;
}

/** Keeps only the entries that are genuinely usable rates.
 *
 * The upstream response was read with `as { rates: FxRates["rates"] }` - a
 * type assertion over a network payload, which is the same non-check that
 * test:shape exists to stop on the worker side. Whatever came back was
 * cached for twelve hours and served to every visitor.
 *
 * Returns a fresh object containing only supported currencies mapped to
 * finite positive numbers. An unrecognised currency, a string, a zero and a
 * null are all dropped rather than corrected, because "no live rate" is a
 * state this product already handles correctly everywhere (formatMoney
 * falls back to EUR) and a fabricated one is not. */
export function sanitizeRates(value: unknown): FxRates["rates"] {
  const out: FxRates["rates"] = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isSupportedCurrency(key) || key === "EUR") continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    out[key] = raw;
  }
  return out;
}
