// A meal the plan said a day should have, still missing after the repairs.
//
// The meal repair asks the model for a place, and when that answer is
// empty or does not survive verification the day simply has no breakfast
// (a real Rome run: "day 2 has no breakfast"). Google knows what is
// actually there, so the slot is filled the way fillUnnamedMeals fills an
// unnamed meal: a placeholder goes in at a sensible time near where the
// traveller is, the same direct Places search names it, and a placeholder
// nothing good was found for is taken out again. A day never gains an
// unnamed "Breakfast" line from this.
//
// Run: npm run test:meal-gaps

import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "../types";
import { missingMealsFor } from "./quality";
import type { MealSlot, SkeletonDay } from "./twoPhase";

const TITLE: Record<"en" | "bg", Record<MealSlot, string>> = {
  en: { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" },
  bg: { breakfast: "Закуска", lunch: "Обяд", dinner: "Вечеря" },
};

const REASONING: Record<"en" | "bg", string> = {
  en: "A well-rated place near where you are at that time, open then, picked from Google Maps.",
  bg: "Добре оценено място близо до теб по това време, отворено тогава, избрано от Google Maps.",
};

/** A rough cost per person, labelled as an estimate on the page. */
const PER_PERSON_EUR: Record<MealSlot, number> = { breakfast: 10, lunch: 18, dinner: 30 };

function minutes(time: unknown): number | null {
  const m = typeof time === "string" ? /^(\d{1,2}):(\d{2})$/.exec(time.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Where the traveller is around `at`: the location of the line closest in
 * time, or for breakfast the night's accommodation when there is one. */
function locationNear(day: ItineraryDay, previous: ItineraryDay | undefined, at: number, slot: MealSlot): string {
  if (slot === "breakfast") {
    const bed = [...(previous?.items ?? []), ...day.items].find((i) => i?.type === "lodging" && text(i.location));
    if (bed) return text(bed.location);
  }
  let best: { loc: string; gap: number } | null = null;
  for (const item of day.items) {
    if (!item || item.type === "transport") continue;
    const t = minutes(item.time);
    const loc = text(item.location);
    if (t === null || !loc) continue;
    const gap = Math.abs(t - at);
    if (!best || gap < best.gap) best = { loc, gap };
  }
  return best?.loc ?? "";
}

/** Adds a placeholder for each meal a planned day still owes, and returns
 * them so the caller can take out the ones Places could not name. */
export function addMealPlaceholders(
  itinerary: Itinerary,
  planDays: SkeletonDay[],
  brief: Pick<TripBriefInput, "language" | "party_size">
): ItineraryItem[] {
  const lang = brief.language === "bg" ? "bg" : "en";
  const party = Number.isFinite(brief.party_size) && brief.party_size > 0 ? brief.party_size : 1;
  const plans = new Map(planDays.map((p) => [p.day, p]));
  const added: ItineraryItem[] = [];
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];

  days.forEach((day, index) => {
    if (!day || typeof day !== "object" || !Array.isArray(day.items)) return;
    const plan = plans.get(day.day);
    if (!plan) return;
    const times = day.items.map((i) => minutes(i?.time)).filter((t): t is number => t !== null);
    const earliest = times.length > 0 ? Math.min(...times) : null;

    for (const slot of missingMealsFor(day, plan)) {
      let at: number;
      if (slot === "breakfast") {
        // Before the day's first thing, and not at dawn: a day that starts
        // before 7:30 (an early flight) has no room for one.
        if (earliest !== null && earliest < 7 * 60 + 30) continue;
        at = Math.max(7 * 60, Math.min(8 * 60 + 30, (earliest ?? 9 * 60 + 30) - 60));
      } else {
        at = slot === "lunch" ? 13 * 60 : 19 * 60 + 30;
      }
      const location = locationNear(day, index > 0 ? days[index - 1] : undefined, at, slot);
      if (!location) continue;
      const item = {
        time: clock(at),
        type: "meal",
        title: TITLE[lang][slot],
        location,
        cost_estimate_eur: PER_PERSON_EUR[slot] * party,
        reasoning: REASONING[lang],
        source_confidence: "inferred",
      } as ItineraryItem;
      day.items.push(item);
      added.push(item);
    }
  });
  return added;
}

/** Takes out the placeholders nothing was found for. Returns how many
 * stayed, now named. */
export function removeUnfilledPlaceholders(itinerary: Itinerary, placeholders: ItineraryItem[]): number {
  const unfilled = new Set(placeholders.filter((p) => !text(p.venue_name)));
  if (unfilled.size > 0) {
    for (const day of itinerary.days ?? []) {
      if (day && Array.isArray(day.items)) day.items = day.items.filter((i) => !unfilled.has(i));
    }
  }
  return placeholders.length - unfilled.size;
}
