// What the traveller actually spent, line by line, against the plan.
//
// Kept in this browser only (localStorage, per trip): what someone paid
// for dinner is theirs, and it is entered on the phone they travel with.
// Stored in EUR, the currency the plan is priced in, so switching the
// page's currency converts both sides the same way. Entered in whatever
// currency the page is showing, converted with the same live rate the
// page displays - or taken as EUR when there is no rate, never guessed.
//
// Run: npm run test:spending

import type { Currency, FxRates } from "./currency";
import { itemPriceEur } from "./engine/money";
import type { ItineraryDay } from "./types";

export type SpendMap = Record<string, number>;

const PREFIX = "decide:spend:";
const REF = /^d\d{1,3}\.\d{1,3}$/;

export function spendRef(day: number, index: number): string {
  return `d${day}.${index + 1}`;
}

/** A stored map, with anything that is not a non-negative finite amount
 * against a line reference dropped. */
export function readSpendMap(value: unknown): SpendMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SpendMap = {};
  for (const [ref, amount] of Object.entries(value as Record<string, unknown>)) {
    if (REF.test(ref) && typeof amount === "number" && Number.isFinite(amount) && amount >= 0) out[ref] = amount;
  }
  return out;
}

export function loadSpending(jobId: string): SpendMap {
  try {
    return readSpendMap(JSON.parse(window.localStorage.getItem(PREFIX + jobId) ?? "{}"));
  } catch {
    return {};
  }
}

export function saveSpending(jobId: string, map: SpendMap): void {
  try {
    window.localStorage.setItem(PREFIX + jobId, JSON.stringify(map));
  } catch {
    // Private browsing or a full quota: the tracker just does not persist.
  }
}

/** An amount typed in `currency` as EUR, or null when it is not a number.
 * Without a usable live rate the amount is taken as EUR, which is what the
 * input's label says in that case (see spendingCurrency). */
export function toEur(typed: string, currency: Currency, rates: FxRates | null): number | null {
  const amount = Number(typed.replace(",", ".").trim());
  if (!typed.trim() || !Number.isFinite(amount) || amount < 0) return null;
  const rate = spendingRate(currency, rates);
  return Math.round((amount / rate) * 100) / 100;
}

/** The rate the inputs use: the live one, or 1 (and EUR) when there is none. */
export function spendingRate(currency: Currency, rates: FxRates | null): number {
  if (currency === "EUR") return 1;
  const rate = rates?.rates?.[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function spendingCurrency(currency: Currency, rates: FxRates | null): Currency {
  return spendingRate(currency, rates) === 1 && currency !== "EUR" ? "EUR" : currency;
}

export interface SpendingSummary {
  /** The whole plan's priced lines. */
  plannedEur: number;
  spentEur: number;
  /** Lines with an amount entered. */
  tracked: number;
  /** What the plan expected for just those lines, for "over or under". */
  plannedForTrackedEur: number;
}

export function spendingSummary(days: ItineraryDay[], spent: SpendMap): SpendingSummary {
  const summary: SpendingSummary = { plannedEur: 0, spentEur: 0, tracked: 0, plannedForTrackedEur: 0 };
  for (const day of days ?? []) {
    (day.items ?? []).forEach((item, index) => {
      const price = itemPriceEur(item);
      if (Number.isFinite(price)) summary.plannedEur += price;
      const amount = spent[spendRef(day.day, index)];
      if (typeof amount === "number") {
        summary.spentEur += amount;
        summary.tracked++;
        if (Number.isFinite(price)) summary.plannedForTrackedEur += price;
      }
    });
  }
  return summary;
}
