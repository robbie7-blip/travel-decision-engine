// Ported from engine.py's check_feasibility / check_budget_integrity.
// These are the rule-based sanity checks that run on top of the LLM output -
// what makes the product trustworthy rather than just plausible-sounding.

// Relative, not "@/lib/types" - this file is also imported directly by the
// worker (a separate Node project outside the Next.js app), which doesn't
// have the Next.js path-alias resolution configured.
import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "../types";

/** Flags days with too much scheduled in them.
 *
 * Counts ACTIVITIES, not meals. It used to flag any day with more than five
 * activity-or-meal items, which was a fair proxy back when a day might or
 * might not bother with lunch - but every full day now carries three meals
 * by construction (see SkeletonDay.meals in engine/twoPhase.ts), so that
 * threshold left room for only two activities before warning the traveler
 * that a perfectly normal day was overpacked. Eating three times is not
 * overpacking. Meals still count toward a generous overall ceiling, since a
 * day really can have too much in it in total. */
const MAX_ACTIVITIES_PER_DAY = 5;
// Raised once the day prompt started demanding three meals, a written
// afternoon and real transport between areas. A genuinely good Rome day now
// runs to nine items - breakfast, metro, sight, sight, coffee, walk, metro,
// gallery, dinner - and warning the traveler that it is "likely overpacked"
// would be the product second-guessing its own instructions on the page.
const MAX_SCHEDULED_ITEMS_PER_DAY = 10;

export function checkFeasibility(itinerary: Itinerary): Itinerary {
  for (const day of itinerary.days ?? []) {
    const activities = day.items.filter((i) => i.type === "activity");
    const scheduled = day.items.filter((i) => i.type === "activity" || i.type === "meal");
    if (activities.length > MAX_ACTIVITIES_PER_DAY) {
      day.feasibility_flag = `${activities.length} activities scheduled in one day - likely overpacked, review pacing.`;
    } else if (scheduled.length > MAX_SCHEDULED_ITEMS_PER_DAY) {
      day.feasibility_flag = `${scheduled.length} activities and meals scheduled in one day - likely overpacked, review pacing.`;
    }
  }
  return itinerary;
}

/** Finds the accommodation item nearest (by day number) to `targetDay` -
 * "nearest" rather than always "the first one," since a multi-destination
 * trip can have different lodging in different cities, and cloning the
 * closest one is a much safer guess than always reusing day 1's. */
function nearestLodgingItem(days: ItineraryDay[], targetDay: number): ItineraryItem | null {
  let best: ItineraryItem | null = null;
  let bestDistance = Infinity;
  let bestDay = -Infinity;
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== "lodging") continue;
      const distance = Math.abs(day.day - targetDay);
      // On a tie, take the LATER night. The earliest lodging item in a trip
      // is the arrival night, and its title says "check in" - cloning that
      // onto night three tells the traveler to check in somewhere they are
      // already staying. A later night's wording ("another night at...")
      // is correct for any night it might be copied to.
      if (distance < bestDistance || (distance === bestDistance && day.day > bestDay)) {
        best = item;
        bestDistance = distance;
        bestDay = day.day;
      }
    }
  }
  return best;
}

/** Clones the nearest existing accommodation item into any day (1..nights)
 * that's missing one. The model is instructed to include exactly one
 * accommodation item per night (see the ACCOMMODATION LINE ITEMS rule in
 * prompt.ts) but has been observed to occasionally skip a night - which
 * silently undercounts the total shown to the traveler, since that total is
 * summed directly from item costs, not from the model's own
 * budget_feasibility math. Fixing the gap here (not just flagging it) means
 * the displayed total is actually correct, and there's nothing left that
 * needs explaining to the traveler with a scary warning banner - a past
 * version of this check surfaced a big red "MISMATCH... treat with
 * suspicion" banner for exactly this case, which is a bad way to greet
 * someone excited about a trip they just planned. */
/** Neutral wording for a night that was cloned rather than written.
 *
 * Preferring a later night to copy from only helps when a later night
 * exists. When the model writes the arrival night and nothing else - which
 * is exactly when this repair is most needed - the only item to clone says
 * "check in", and copying that onto night three tells the traveler to check
 * in somewhere they are already staying.
 *
 * So the title is written here instead of inherited. The trip's language is
 * known and there are two of them, which makes this a small lookup rather
 * than a translation problem, and a plain correct line beats an inherited
 * wrong one. */
function clonedNightTitle(language: TripBriefInput["language"], venue: string | null | undefined): string {
  if (language === "bg") return venue ? `Нощувка в ${venue}` : "Нощувка в хотела";
  return venue ? `Another night at ${venue}` : "Another night at the accommodation";
}

function fillMissingLodgingNights(
  days: ItineraryDay[],
  nights: number,
  language: TripBriefInput["language"]
): void {
  const dayByNumber = new Map(days.map((d) => [d.day, d]));
  const firstLodgingDay = Math.min(
    ...days.filter((d) => d.items.some((i) => i.type === "lodging")).map((d) => d.day)
  );
  for (let dayNum = 1; dayNum <= nights; dayNum++) {
    const day = dayByNumber.get(dayNum);
    if (!day || day.items.some((item) => item.type === "lodging")) continue;
    const reference = nearestLodgingItem(days, dayNum);
    if (!reference) continue;
    const clone: ItineraryItem = { ...reference };
    // Any night after the first is not an arrival, whatever the item we
    // copied happened to say. Retimed too: a 13:15 check-in cloned onto a
    // later night would otherwise sit in the middle of that afternoon.
    if (dayNum > firstLodgingDay) {
      clone.title = clonedNightTitle(language, reference.venue_name);
      clone.time = "21:00";
    }
    day.items.push(clone);
  }
}

/** Cross-checks the itinerary structurally against what a `nights`-night
 * trip actually needs, rather than trusting the model's self-reported
 * budget_feasibility alone - the model has been observed to be INCONSISTENT
 * across runs, sometimes quietly omitting an accommodation night. Repairs
 * the gap directly (see fillMissingLodgingNights) when there's a real
 * accommodation item to clone from, rather than surfacing it as a
 * user-facing warning - the fix makes the displayed total accurate, which
 * is the thing that actually matters to the traveler. The one case this
 * can't repair (a trip with NO accommodation items at all despite needing
 * some) has no reference price to clone, so it's logged for our own
 * visibility rather than fabricated or flagged to the traveler. */
export function checkBudgetIntegrity(itinerary: Itinerary, brief: TripBriefInput): Itinerary {
  let nights = 0;
  if (brief.start_date && brief.end_date) {
    const d1 = new Date(brief.start_date);
    const d2 = new Date(brief.end_date);
    nights = Math.max(Math.round((d2.getTime() - d1.getTime()) / 86_400_000), 0);
  }

  const days = itinerary.days ?? [];
  const lodgingItems = days.flatMap((day) => day.items.filter((item) => item.type === "lodging"));

  if (brief.needs_lodging && nights > 0 && lodgingItems.length === 0) {
    console.warn(
      `[checkBudgetIntegrity] 0 accommodation items for a ${nights}-night trip - no reference item to auto-fill from.`
    );
  } else if (nights > 0 && lodgingItems.length > 0 && lodgingItems.length < nights) {
    fillMissingLodgingNights(days, nights, brief.language);
  }

  return itinerary;
}

/** Derives each item's confidence_tier from the cross-check signals the
 * model already reported (source_urls, source_agreement) rather than having
 * the model self-report a tier directly - same "verify structurally" reason
 * checkBudgetIntegrity doesn't trust budget_feasibility.feasible on its own. */
export function deriveConfidenceTiers(itinerary: Itinerary): Itinerary {
  for (const day of itinerary.days ?? []) {
    for (const item of day.items) {
      const urlCount = item.source_urls?.length ?? 0;
      if (item.source_confidence !== "grounded") {
        item.confidence_tier = "inferred";
      } else if (urlCount === 0) {
        // Grounded in the curated facts base, not a live search - most
        // non-lodging items. Distinct from "inferred": it's still checked
        // data, just not search-cross-checked.
        item.confidence_tier = "fact_grounded";
      } else if (urlCount >= 2 && item.source_agreement === "disagree") {
        item.confidence_tier = "conflicting";
      } else if (urlCount >= 2 && item.source_agreement === "agree") {
        item.confidence_tier = "verified";
      } else {
        item.confidence_tier = "single_source";
      }
    }
  }
  return itinerary;
}
