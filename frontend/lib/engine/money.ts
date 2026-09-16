// What counts as a price, and what counts as a citation for one, on
// model-written JSON.
//
// THE GAP THIS CLOSES. types.ts declares `cost_estimate_eur: number` and 30-odd
// readers believe it, but the value arrives from `JSON.parse(text) as
// ItineraryDay` - a type assertion, which tells the compiler what to believe
// and verifies nothing. Nothing between the model's JSON and the trip total
// ever checked that a price is a number.
//
// Measured, not inferred. With ONE item priced `"20"` instead of `20` - the
// likeliest slip a model makes, and the one that looks perfectly fine on the
// page, because `Math.round("20")` is 20:
//
//   the trip total  10 + "20" + 30  ->  "102030"
//
// which is a string, and `Math.round` of it is 102030. So
// budget_matches_items reports "the items add up to EUR 102030 against a EUR
// 2000 budget", stamps a defect on a trip that is fine, and CompareView shows
// EUR 102030 as the cost of four days in Rome. With `"15-20"` - a model
// hedging, which the prompt asks for in prose and not here - the total is
// `"1015-2030"`, `Math.round` of it is NaN, and the item's own line renders
// "EUR NaN".
//
// WHY A SHARED MODULE rather than a check at each sum. Because there were
// already three different answers in the tree: quality.ts's prices_present
// tests `typeof === "number"`, the meal-repair reader tests the same, and the
// two places that add the prices up test nothing. A price either is one or is
// not, and that question is worth exactly one answer. lodgingCache.ts had the
// fourth copy of the string half and now imports it from here.
//
// Run: npm run test:money

import type { ItineraryItem } from "../types";

/** A plain decimal number from a string, or NaN.
 *
 * Forgives the decoration a model puts on a price it has written as text -
 * a currency symbol or code on either side, thousands separators between
 * digit groups - and refuses everything else, which is the important half:
 * a RANGE ("15-20"), a hedge ("about 20"), a unit ("20 per person") and a
 * word ("twenty") all come back NaN rather than being guessed at. Recovering
 * "20" keeps a real price that was merely typed wrong; recovering "15-20" as
 * 15 or as 20 would invent one.
 *
 * Moved here from lodgingCache.ts, which had the only copy, and left
 * byte-identical in behaviour - its own suite is what says so. */
export function parseCurrencyNumber(value: string): number {
  const stripped = value
    .trim()
    // Currency symbols and codes, on either side.
    .replace(/^(eur|usd|gbp|€|\$|£)\s*/i, "")
    .replace(/\s*(eur|usd|gbp|€|\$|£)$/i, "")
    // Thousands separators, but only between digit groups, so "1,200"
    // becomes 1200 while "1,2" is left to fail the test below.
    .replace(/(?<=\d),(?=\d{3}(\D|$))/g, "")
    .trim();
  // A plain decimal number and nothing else. Number("") is 0 and
  // Number(" ") is 0, which is why the pattern is required rather than
  // relying on Number() to refuse.
  return /^\d+(\.\d+)?$/.test(stripped) ? Number(stripped) : Number.NaN;
}

/** A price this app can add up and print, or null.
 *
 * Zero is allowed through, deliberately: it is a real price for a free
 * museum or a walk, and quality.ts's prices_present is the thing that
 * decides zero is wrong for a meal, a bed or a flight. Negative is not - a
 * price below zero subtracts from the trip total, which no line item should
 * ever do.
 *
 * Not capped at the top. A finite, absurdly large number is the model
 * making a claim, and the budget gate is what reports it; refusing it here
 * would only hide it. NaN and Infinity are not claims and are refused. */
export function usableCostEur(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string") {
    const parsed = parseCurrencyNumber(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/** The same, for adding up: an unusable price counts as nothing.
 *
 * Safe in a SUM specifically, and the quality gate already says why in its
 * own words - "an item with no price makes the sum an UNDER-estimate", and
 * budget_matches_items only ever fires when the total is over despite that.
 * So a missing price cannot manufacture a defect here; a string price could,
 * and did. */
export function costForSum(value: unknown): number {
  return usableCostEur(value) ?? 0;
}

/** How many source URLs this item actually has, and which.
 *
 * `source_urls` is written directly by the model, and deriveConfidenceTiers
 * counted it with `item.source_urls?.length ?? 0`. On a string, `.length` is
 * the CHARACTER COUNT - so one URL written as a bare string instead of a
 * one-element array measured 45, cleared the `>= 2` test, and with
 * source_agreement "agree" the item was stamped "verified": the top trust
 * tier, which means two independent sources agreed, awarded for one source
 * because its URL was long. Measured, not inferred. That tier is the single
 * strongest claim this product makes on a page whose whole subject is how
 * much of the trip is actually checked.
 *
 * The same value then reached the page as `(item.source_urls ?? []).map(...)`,
 * and a string has no `.map` - a TypeError during render of a paid itinerary,
 * the failure class formatMoney's own header is about.
 *
 * Entries go through the URL gate rather than merely being counted, because
 * a tier and a citation have to agree: safeHref already refuses to link
 * "booking.com" or "(none found)", so counting them left the page showing
 * "single source" above zero clickable links. */
export function sourceUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const entry of value) {
    const url = usableSourceUrl(entry);
    if (url !== null) urls.push(url);
  }
  return urls;
}

/** An http(s) URL a traveler can be shown as the source of a price, or null.
 *
 * `source_url` was carried straight from the model's JSON into
 * `source_urls`, which the trip page renders as the citation behind a
 * "verified" badge. So a reply of `"source_url": "booking.com"` or
 * `"(none found)"` - both things a model writes when it has nothing - put
 * an unclickable string behind a claim that the price had been checked.
 * Dropping it leaves `source_confidence` to speak for itself, which is
 * what the unnamed-source case already does. */
export function usableSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString().slice(0, 500);
}

/** Whether a price of zero on this item means "free" or means "we don't
 * have one".
 *
 * quality.ts has always drawn this line and stated it plainly - "zero is a
 * real, valid price for a free museum or a walk. It is not a valid price for
 * a meal, a bed, or a flight" - and records the second case as a
 * prices_present defect. The trip page drew no line at all and printed
 * "Free" for every zero, so a restaurant dinner the app had no price for was
 * shown to the traveler as costing nothing. Two places, one judgement, so it
 * is written once. */
export function mustCost(item: Pick<ItineraryItem, "type" | "is_flight">): boolean {
  return item.type === "meal" || item.type === "lodging" || item.is_flight === true;
}

/** The figure to PRINT for an item, which is not always the figure stored.
 *
 * A zero on a meal, a bed or a flight is not a price, so it is handed on as
 * one that cannot be read - formatMoney answers its NO_FIGURE marker and
 * the page states no figure rather than a wrong one. Everything else passes straight through,
 * including a real zero on a free activity. */
export function itemPriceEur(item: Pick<ItineraryItem, "type" | "is_flight" | "cost_estimate_eur">): number {
  const usable = usableCostEur(item.cost_estimate_eur);
  if (usable === null) return Number.NaN;
  if (usable === 0 && mustCost(item)) return Number.NaN;
  return usable;
}
