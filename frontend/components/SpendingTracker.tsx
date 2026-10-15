"use client";

// The spending tracker on a trip (lib/spending.ts): a "Spent" field under
// each line and a running total against the plan. Off until the traveller
// turns it on for this trip; remembered on this device.

import { useCallback, useEffect, useState } from "react";
import { CURRENCY_SYMBOLS, formatMoney, type Currency, type FxRates } from "@/lib/currency";
import type { Dictionary } from "@/lib/i18n";
import type { ItineraryDay } from "@/lib/types";
import {
  loadSpending,
  saveSpending,
  spendingCurrency,
  spendingRate,
  spendingSummary,
  toEur,
  type SpendMap,
} from "@/lib/spending";

const ON_PREFIX = "decide:spend-on:";

export function useSpending(jobId: string) {
  const [on, setOn] = useState(false);
  const [spent, setSpent] = useState<SpendMap>({});

  useEffect(() => {
    setSpent(loadSpending(jobId));
    try {
      setOn(window.localStorage.getItem(ON_PREFIX + jobId) === "1");
    } catch {
      setOn(false);
    }
  }, [jobId]);

  const toggle = useCallback(() => {
    setOn((prev) => {
      try {
        if (prev) window.localStorage.removeItem(ON_PREFIX + jobId);
        else window.localStorage.setItem(ON_PREFIX + jobId, "1");
      } catch {
        // not persisted; still works for this visit
      }
      return !prev;
    });
  }, [jobId]);

  const setAmount = useCallback(
    (ref: string, eur: number | null) => {
      setSpent((prev) => {
        const next = { ...prev };
        if (eur === null) delete next[ref];
        else next[ref] = eur;
        saveSpending(jobId, next);
        return next;
      });
    },
    [jobId]
  );

  return { on, toggle, spent, setAmount };
}

export function SpendInput({
  spendRef,
  stored,
  currency,
  rates,
  onCommit,
  t,
}: {
  spendRef: string;
  stored: number | undefined;
  currency: Currency;
  rates: FxRates | null;
  onCommit: (ref: string, eur: number | null) => void;
  t: Dictionary;
}) {
  const shown = spendingCurrency(currency, rates);
  const rate = spendingRate(currency, rates);
  const fromStore = stored === undefined ? "" : String(Math.round(stored * rate * 100) / 100);
  const [draft, setDraft] = useState(fromStore);
  useEffect(() => setDraft(fromStore), [fromStore]);
  const id = `spend-${spendRef}`;

  return (
    <label className="spend-input font-ui no-print" htmlFor={id}>
      <span>{t.result.spending.spent}</span>
      <span className="spend-input-box">
        <span aria-hidden>{CURRENCY_SYMBOLS[shown]}</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const eur = toEur(draft, currency, rates);
            if (eur === null && draft.trim()) {
              setDraft(fromStore);
              return;
            }
            onCommit(spendRef, eur);
          }}
        />
      </span>
    </label>
  );
}

export function SpendingSummaryBar({
  days,
  spent,
  currency,
  rates,
  t,
}: {
  days: ItineraryDay[];
  spent: SpendMap;
  currency: Currency;
  rates: FxRates | null;
  t: Dictionary;
}) {
  const s = spendingSummary(days, spent);
  const copy = t.result.spending;
  const diff = s.spentEur - s.plannedForTrackedEur;
  return (
    <div className="spend-summary font-ui no-print" aria-live="polite">
      <div className="spend-summary-main">
        {copy.total
          .replace("{spent}", formatMoney(s.spentEur, currency, rates))
          .replace("{planned}", formatMoney(s.plannedEur, currency, rates))}
      </div>
      <div className="spend-summary-sub">
        {s.tracked === 0
          ? copy.hint
          : Math.abs(diff) < 1
            ? copy.onPlan
            : (diff > 0 ? copy.over : copy.under).replace("{amount}", formatMoney(Math.abs(diff), currency, rates))}
      </div>
    </div>
  );
}
