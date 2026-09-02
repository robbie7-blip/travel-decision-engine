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

  const rate = rates?.rates[currency];
  if (rate == null) return `€${Math.round(amountEur)}`;

  return `${CURRENCY_SYMBOLS[currency]}${Math.round(amountEur * rate)}`;
}
