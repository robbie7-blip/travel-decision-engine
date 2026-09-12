// Real currency conversion for the structured cost figures decide already
// tracks as numbers (ItineraryItem.cost_estimate_eur, BudgetFeasibility.
// min_realistic_total_eur) - never for the free-text prose the model writes
// (trip_summary, budget_feasibility.reasoning, item.reasoning), which often
// embeds its own "€X" mentions inline. Regex-swapping currency symbols
// inside generated sentences risks a silently wrong number in a claim that
// looks authoritative - worse than just leaving that prose in EUR - so
// those stay untouched; only the structured fields convert.

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
  if (currency === "EUR") return `€${Math.round(amountEur)}`;

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
    return `€${Math.round(amountEur)}`;
  }

  return `${CURRENCY_SYMBOLS[currency]}${Math.round(amountEur * rate)}`;
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
