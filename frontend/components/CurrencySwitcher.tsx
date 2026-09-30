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
    // The caret is a sibling of the select, not a pseudo-element on the
    // row's wrapper, because that wrapper goes full-width below 345px (see
    // .header-extra-control) and a caret pinned to ITS right edge ended up
    // half a screen away from the control it belongs to. This span is
    // shrink-to-fit, so the caret stays on the select at every width.
    <span className="currency-chip">
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as Currency)}
        aria-label={label}
        // No inline box styling any more. This control had its own padding,
        // its own type size and its own colour, and so did each of the three
        // controls beside it - four sets of numbers that nobody could keep
        // in step, and didn't. .header-chip is the box for all four;
        // .currency-select adds only what is specific to being a <select>.
        className="font-ui header-chip currency-select"
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="currency-chip-caret" aria-hidden />
    </span>
  );
}
