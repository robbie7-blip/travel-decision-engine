// The cities a plan actually goes to, out of the ones that were asked for.
//
// A push back can drop a city ("skip Munich, keep it to the lake") while
// the trip's brief still lists it, because the brief is what was asked
// for, not what was planned. The page took its title, its weather, its
// packing list and its "plan a trip like this" from the brief, so the
// header kept saying "Friedrichshafen · Munich · Vaduz" over a plan with
// no Munich in it. The days are the truth: a city counts if some line on
// some day names it, in its title or its location.
//
// Run: npm run test:trip-cities

import type { ItineraryDay } from "./types";

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** The requested cities the days mention, in the order they were asked
 * for. All of them when the days mention none (a plan whose lines name
 * only streets and venues), since showing nothing would be worse than
 * showing what was asked. */
export function citiesInPlan(requested: string[] | undefined, days: ItineraryDay[] | undefined): string[] | undefined {
  if (!requested || requested.length < 2 || !days || days.length === 0) return requested;
  const text = fold(
    days
      .flatMap((day) => (day?.items ?? []).map((item) => `${item?.title ?? ""} ${item?.location ?? ""}`))
      .join(" | ")
  );
  const kept = requested.filter((city) => {
    // The place's own name, without a ", Country" the brief may carry.
    const name = fold(city.split(",")[0].trim());
    return name.length > 0 && new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(text);
  });
  return kept.length > 0 ? kept : requested;
}
