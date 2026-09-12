// Money on the page, in the currency the traveller picked.
//
// Two defects lived here, and the second one blanked the trip page.
//
// formatMoney read `rates?.rates[currency]`. Look at where the optional
// chain stops: it guarded the whole object being null and NOT the `rates`
// map inside it being absent, so `undefined[currency]` threw a TypeError.
// The type says that cannot happen - but the type is an assertion on a JSON
// payload that crosses a network boundary, which is not the same thing.
//
// It was reachable through /api/rates, which read the upstream response with
// a bare `as { rates: FxRates["rates"] }` - a type assertion, not a check,
// the same non-check test:shape exists to stop on the worker side - and
// cached whatever came back for TWELVE HOURS. A 200 whose body had no
// `rates` key cached `rates: undefined`, JSON.stringify dropped the field,
// and every trip page render threw inside formatMoney: for every visitor,
// for twelve hours, on itineraries people had paid for.
//
// The third case is quieter and also real: a rate that is present but not a
// usable number (a string, a zero, a negative, a NaN) reached
// Math.round(amountEur * rate) and printed nonsense - or the literal "NaN" -
// against a real currency symbol. Showing the honest EUR figure is strictly
// better than showing a confident wrong one.
//
// Pure arithmetic over an object, no network.
//
// Run: npm run test:currency

import { formatMoney, isSupportedCurrency, sanitizeRates, type FxRates } from "./currency";
import { check, finish, heading, section } from "./testutil";

heading("currency conversion");

const withRates = (rates: FxRates["rates"]): FxRates => ({ base: "EUR", rates, fetchedAt: Date.now() });

function main() {
  section("the ordinary conversion");

  {
    check("EUR needs no rate at all", formatMoney(100, "EUR", null) === "€100");
    check("a real rate converts and takes the symbol", formatMoney(100, "USD", withRates({ USD: 1.08 })) === "$108", formatMoney(100, "USD", withRates({ USD: 1.08 })));
    check("BGN uses its own symbol", formatMoney(50, "BGN", withRates({ BGN: 1.96 })) === "лв98", formatMoney(50, "BGN", withRates({ BGN: 1.96 })));
    check("the figure is rounded, never fractional", formatMoney(33, "USD", withRates({ USD: 1.085 })) === "$36", formatMoney(33, "USD", withRates({ USD: 1.085 })));
  }

  section("no live rate falls back to the honest EUR figure");

  {
    check("rates still loading", formatMoney(100, "USD", null) === "€100");
    check("rates fetched but this currency missing", formatMoney(100, "JPY", withRates({ USD: 1.08 })) === "€100");
    check("an empty rate map", formatMoney(100, "USD", withRates({})) === "€100");
  }

  section("the TypeError that blanked the trip page");

  {
    // `{ base, fetchedAt }` with no `rates` key at all - exactly what
    // /api/rates served after caching an upstream body that had none, since
    // JSON.stringify drops an undefined field.
    const noMap = { base: "EUR", fetchedAt: Date.now() } as unknown as FxRates;
    let threw = false;
    let out = "";
    try {
      out = formatMoney(100, "USD", noMap);
    } catch {
      threw = true;
    }
    check("a rates object with no map does not throw", threw === false);
    check("and falls back to EUR", out === "€100", out);
  }

  {
    const nullMap = { base: "EUR", rates: null, fetchedAt: 1 } as unknown as FxRates;
    let threw = false;
    try {
      formatMoney(100, "USD", nullMap);
    } catch {
      threw = true;
    }
    check("an explicitly null map does not throw either", threw === false);
  }

  section("a rate that is present but not usable");

  {
    const bad = (v: unknown) => formatMoney(100, "USD", { base: "EUR", rates: { USD: v }, fetchedAt: 1 } as unknown as FxRates);
    check("a string rate falls back rather than concatenating", bad("1.08") === "€100", bad("1.08"));
    check("zero falls back rather than printing $0", bad(0) === "€100", bad(0));
    check("a negative falls back rather than printing a negative price", bad(-1.08) === "€100", bad(-1.08));
    check("NaN falls back rather than printing $NaN", bad(Number.NaN) === "€100", bad(Number.NaN));
    check("Infinity falls back", bad(Number.POSITIVE_INFINITY) === "€100", bad(Number.POSITIVE_INFINITY));
    check("null falls back", bad(null) === "€100", bad(null));
  }

  section("sanitizeRates, which is what stops any of that being cached");

  {
    const clean = sanitizeRates({ USD: 1.08, GBP: 0.84, JPY: 162 });
    check("real rates come through", JSON.stringify(clean) === '{"USD":1.08,"GBP":0.84,"JPY":162}', JSON.stringify(clean));
  }

  {
    const mixed = sanitizeRates({ USD: 1.08, GBP: "0.84", JPY: 0, CHF: -1, BGN: null, XYZ: 5 });
    check("only the usable entry survives", JSON.stringify(mixed) === '{"USD":1.08}', JSON.stringify(mixed));
  }

  {
    // EUR is the base. A rate for it would be meaningless and formatMoney
    // never consults one.
    check("a rate for the base currency is dropped", JSON.stringify(sanitizeRates({ EUR: 1, USD: 1.08 })) === '{"USD":1.08}', JSON.stringify(sanitizeRates({ EUR: 1, USD: 1.08 })));
  }

  {
    // The shapes that reach this from a network payload. Every one of them
    // must come back as an empty map, because an empty map is the signal
    // /api/rates uses to refuse to cache.
    for (const input of [undefined, null, 0, "", "nope", [], {}, { rates: { USD: 1.08 } }, Number.NaN]) {
      const out = sanitizeRates(input);
      check(
        `${JSON.stringify(input) ?? "undefined"} sanitizes to an empty map`,
        typeof out === "object" && out !== null && Object.keys(out).length === 0,
        JSON.stringify(out)
      );
    }
  }

  {
    // The upstream body that caused it: a 200 with no rates key.
    const fromUpstream = sanitizeRates(({ amount: 1, base: "EUR", date: "2026-09-12" } as { rates?: unknown }).rates);
    check("a body with no rates key yields an empty map, not undefined", Object.keys(fromUpstream).length === 0);
    check("so the route has something safe to serve", formatMoney(100, "USD", withRates(fromUpstream)) === "€100");
  }

  {
    // A fresh object every call, so a caller sorting or deleting entries
    // cannot reach into the cached value. This route's result is shared by
    // every visitor.
    const source = { USD: 1.08 };
    const a = sanitizeRates(source);
    const b = sanitizeRates(source);
    delete a.USD;
    check("each call returns its own object", b.USD === 1.08, JSON.stringify(b));
    check("and never the input itself", a !== source);
  }

  section("the currency allowlist");

  {
    check("a supported code is recognised", isSupportedCurrency("BGN") === true);
    check("an unsupported one is not", isSupportedCurrency("XYZ") === false);
    check("case matters, since these come from storage", isSupportedCurrency("usd") === false);
    check("an empty string is not a currency", isSupportedCurrency("") === false);
  }

  finish();
}

main();
