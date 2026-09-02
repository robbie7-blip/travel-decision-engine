"use client";

// Currency preference + live rates, mirroring how language preference works
// (see LANGUAGE_STORAGE_KEY in lib/i18n.ts): persisted to localStorage, one
// hook per page, threaded down as props rather than through context, same
// as the rest of this codebase's convention.

import { useEffect, useState } from "react";
import { CURRENCY_STORAGE_KEY, isSupportedCurrency, SUPPORTED_CURRENCIES, type Currency, type FxRates } from "@/lib/currency";

export function useCurrency(): { currency: Currency; setCurrency: (next: Currency) => void; rates: FxRates | null } {
  const [currency, setCurrencyState] = useState<Currency>("EUR");
  const [rates, setRates] = useState<FxRates | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved && isSupportedCurrency(saved)) setCurrencyState(saved);

    fetch("/api/rates")
      .then((res) => res.json())
      .then((data: FxRates) => setRates(data))
      .catch(() => setRates(null));
  }, []);

  function setCurrency(next: Currency) {
    setCurrencyState(next);
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
  }

  return { currency, setCurrency, rates };
}

export function CurrencySwitcher({
  currency,
  setCurrency,
  label = "Currency",
}: {
  currency: Currency;
  setCurrency: (next: Currency) => void;
  // Defaults to the English word rather than being required - this stays
  // an easy drop-in at call sites that don't have a Dictionary in scope,
  // but every real call site below passes t.currencyLabel explicitly.
  label?: string;
}) {
  return (
    <select
      value={currency}
      onChange={(e) => setCurrency(e.target.value as Currency)}
      aria-label={label}
      className="font-ui currency-select"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 999,
        padding: "6px 10px",
        fontSize: 11,
        letterSpacing: "0.04em",
        background: "var(--bg-panel)",
        color: "var(--ink-dim)",
        cursor: "pointer",
      }}
    >
      {SUPPORTED_CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
