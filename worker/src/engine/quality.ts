// The acceptance gate: what has to be true of an itinerary before a
// traveler is allowed to see it.
//
// Every quality failure this product has shipped has been the same bug
// wearing a different hat. Accommodation came back as "a mid-range hotel"
// with no property name. Days came back with no lunch and no dinner. Two
// days named the same cafe. Nineteen percent of line items were backed by
// anything. In each case the pipeline ran to completion, wrote "done" on
// the job, and served it — because nothing in it had an opinion about what
// a finished itinerary is supposed to look like. The only detector was the
// owner opening the page and noticing.
//
// That is the actual defect. Not the hotel, not the missing lunch: the
// absence of anything between "the model returned JSON" and "ship it".
//
// So this file states the invariants explicitly, checks them
// deterministically, and reports what it found. Three deliberate
// properties:
//
//   1. DETERMINISTIC. Every check here is arithmetic and string matching
//      over the finished itinerary. No model call decides whether the
//      output is good, because a model that just wrote a bad itinerary is
//      not a reliable judge of whether it wrote a bad itinerary.
//
//   2. SEPARATE FROM REPAIR. A check knows how to find a problem and
//      nothing about how to fix it. Repairs live in index.ts, where the
//      Anthropic client is. That split is what lets the gate run twice —
//      once to find work, once to confirm the work landed — without
//      recursion.
//
//   3. RECORDED, NOT JUST ACTED ON. The result is written onto the job
//      (see QualityReport -> Job.quality). A regression stops being
//      something the owner spots in a screenshot two weeks later and
//      becomes a field that every generation carries, aggregable across
//      real traveler traffic without spending a cent on test generations.
//
// Severity is the useful distinction. A "defect" is something a traveler
// would rightly call broken and the pipeline can usually fix. A "warning"
// is a real weakness worth tracking that is not always fixable — a city
// with no hotel worth naming is a fact about the city, not a bug.

import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "../types";
// The report shape lives in jobs.ts because it travels ON the job to the
// frontend, exactly like JobTimings — declaring it twice is how the two
// sides drift.
import type {
  QualityCheckId,
  QualityFinding,
  QualityReport,
} from "../jobs";
export type { QualityCheckId, QualityFinding, QualityReport } from "../jobs";
import { requiredMeals, type MealSlot, type SkeletonDay } from "./twoPhase";

/** Below this, an itinerary is mostly guesswork wearing a confident face.
 * Not a defect, because it can be entirely legitimate (an obscure
 * destination with no curated facts and few venues Places knows), but
 * always worth surfacing — a sustained drop here is the earliest signal
 * that grounding has broken somewhere upstream. */
const MIN_GROUNDED_PERCENT = 40;

/** A day with fewer real things to do than this isn't a day, it's a gap.
 * Meals are excluded from the count on purpose: three meals and nothing
 * else is still an empty day. */
const MIN_ACTIVITIES_PER_FULL_DAY = 1;

function isNamedVenueSlot(item: ItineraryItem): boolean {
  return item.type === "meal" || item.type === "activity";
}

function normalizeVenue(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Which meal a written item represents — same logic the meal repair uses,
 * kept here so the gate and the repair can never disagree about whether a
 * day has lunch. */
export function mealSlotOf(item: ItineraryItem): MealSlot | null {
  const text = `${item.time ?? ""} ${item.title ?? ""}`.toLowerCase();
  if (/breakfast|закуск|desayun|petit.d[ée]jeuner|frühstück|colazione/.test(text)) return "breakfast";
  if (/lunch|об[яе]д|almuerzo|d[ée]jeuner|mittagessen|pranzo/.test(text)) return "lunch";
  if (/dinner|supper|вечер|cena|d[îi]ner|abendessen/.test(text)) return "dinner";

  const hour = parseHour(item.time);
  if (hour == null) return null;
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  return "dinner";
}

function parseHour(time: string | undefined): number | null {
  if (!time) return null;
  const m = /(\d{1,2})[:.]\d{2}/.exec(time);
  if (m) {
    const h = Number(m[1]);
    return h >= 0 && h <= 23 ? h : null;
  }
  const t = time.toLowerCase();
  if (t.includes("morning")) return 9;
  if (t.includes("midday") || t.includes("noon")) return 13;
  if (t.includes("afternoon")) return 15;
  if (t.includes("evening") || t.includes("night")) return 20;
  return null;
}

/** The meals a day is short of, against what the plan said it owed. */
export function missingMealsFor(day: ItineraryDay, plan: SkeletonDay): MealSlot[] {
  const covered = new Set<MealSlot>();
  for (const item of day.items) {
    if (item.type !== "meal") continue;
    const slot = mealSlotOf(item);
    if (slot) covered.add(slot);
  }
  return requiredMeals(plan).filter((m) => !covered.has(m));
}

/** Items naming a venue already used earlier in the trip. First use is
 * kept; each later one is a finding.
 *
 * MEALS AND ACTIVITIES ONLY. Repetition is a defect for those and correct
 * for everything else: a traveler sleeps at the same hotel for five
 * consecutive nights and flies home from the airport they landed at, and
 * neither is the app being careless.
 *
 * That distinction is load-bearing rather than cosmetic. This same function
 * decides what repairDuplicateVenues replaces, so counting lodging here
 * would have the pipeline "fix" night two by booking a different hotel —
 * silently relocating someone mid-stay to solve a problem that did not
 * exist. It stayed harmless only while accommodation had no name to
 * collide on; the moment the property lookup worked, it would have started
 * firing. */
export function duplicateVenueItems(
  days: ItineraryDay[]
): { item: ItineraryItem; day: ItineraryDay }[] {
  const seen = new Set<string>();
  const dupes: { item: ItineraryItem; day: ItineraryDay }[] = [];
  for (const day of [...days].sort((a, b) => a.day - b.day)) {
    for (const item of day.items) {
      if (!isNamedVenueSlot(item)) continue;
      const key = item.venue_name ? normalizeVenue(item.venue_name) : "";
      if (!key) continue;
      if (seen.has(key)) dupes.push({ item, day });
      else seen.add(key);
    }
  }
  return dupes;
}

/** Runs every invariant over a finished itinerary.
 *
 * `plan` is what phase 1 said each day should contain. Without it the
 * meal check can't run — there is no way to tell a legitimately mealless
 * departure morning from a dropped lunch — so it's skipped rather than
 * guessed at, and the skip is itself reported so a run that lost its plan
 * doesn't look like a clean one. */
export function assessQuality(
  itinerary: Itinerary,
  brief: TripBriefInput,
  plan: SkeletonDay[]
): QualityReport {
  const findings: QualityFinding[] = [];
  const days = itinerary.days ?? [];
  const planByNumber = new Map(plan.map((d) => [d.day, d]));

  // --- meals ---------------------------------------------------------
  for (const day of days) {
    const dayPlan = planByNumber.get(day.day);
    if (!dayPlan) continue;
    const missing = missingMealsFor(day, dayPlan);
    if (missing.length > 0) {
      findings.push({
        check: "meals_present",
        severity: "defect",
        day: day.day,
        detail: `day ${day.day} has no ${missing.join(" and no ")}`,
      });
    }
  }

  // --- duplicate venues ----------------------------------------------
  for (const { item, day } of duplicateVenueItems(days)) {
    findings.push({
      check: "no_duplicate_venues",
      severity: "defect",
      day: day.day,
      detail: `day ${day.day} reuses "${item.venue_name}" from an earlier day`,
    });
  }

  // --- named venues ---------------------------------------------------
  // A meal or activity with no venue_name is the generic-chatbot failure
  // mode: "have dinner at a local restaurant" is advice the traveler could
  // have given themselves.
  for (const day of days) {
    for (const item of day.items) {
      if (!isNamedVenueSlot(item)) continue;
      if (item.venue_name && item.venue_name.trim()) continue;
      findings.push({
        check: "venues_named",
        severity: "warning",
        day: day.day,
        detail: `day ${day.day} "${item.title}" names no specific venue`,
      });
    }
  }

  // --- lodging, one per night ----------------------------------------
  if (brief.needs_lodging) {
    const nights = countNights(brief);
    const lodgingItems = days.flatMap((d) => d.items.filter((i) => i.type === "lodging"));
    if (nights > 0 && lodgingItems.length !== nights) {
      findings.push({
        check: "lodging_per_night",
        severity: "defect",
        detail: `${lodgingItems.length} accommodation item(s) for a ${nights}-night trip`,
      });
    }
    // A lodging line with no property name is the single least verifiable
    // row in the itinerary and usually its biggest number. Warning rather
    // than defect: sometimes there genuinely is no property worth naming,
    // and inventing one would be far worse.
    const unnamed = lodgingItems.filter((i) => !i.venue_name || !i.venue_name.trim());
    if (unnamed.length > 0 && unnamed.length === lodgingItems.length) {
      findings.push({
        check: "lodging_named",
        severity: "warning",
        detail: `no accommodation names an actual property (${unnamed.length} night(s) generic)`,
      });
    }
  }

  // --- days that aren't days -------------------------------------------
  for (const day of days) {
    const activities = day.items.filter((i) => i.type === "activity");
    if (activities.length < MIN_ACTIVITIES_PER_FULL_DAY) {
      findings.push({
        check: "day_not_empty",
        severity: "defect",
        day: day.day,
        detail: `day ${day.day} has nothing to do (${day.items.length} item(s), no activity)`,
      });
    }
  }

  // --- prices ----------------------------------------------------------
  // Zero is a real, valid price for a free museum or a walk. It is not a
  // valid price for a meal, a bed, or a flight, and a zero there silently
  // understates the trip total the traveler is budgeting against.
  for (const day of days) {
    for (const item of day.items) {
      const mustCost = item.type === "meal" || item.type === "lodging" || item.is_flight === true;
      if (!mustCost) continue;
      if (typeof item.cost_estimate_eur === "number" && item.cost_estimate_eur > 0) continue;
      findings.push({
        check: "prices_present",
        severity: "defect",
        day: day.day,
        detail: `day ${day.day} "${item.title}" has no price`,
      });
    }
  }

  // --- arrival/departure legs -----------------------------------------
  // Only checked when the brief actually asked for travel to be planned.
  if (brief.needs_flight && brief.origin && days.length > 0) {
    const hasTransport = days.some((d) => d.items.some((i) => i.type === "transport"));
    if (!hasTransport) {
      findings.push({
        check: "transport_legs",
        severity: "defect",
        detail: `trip starts from ${brief.origin} but no transport leg was written`,
      });
    }
  }

  // --- grounding -------------------------------------------------------
  const { groundedPercent, itemCount } = groundedRatio(itinerary);
  if (itemCount > 0 && groundedPercent < MIN_GROUNDED_PERCENT) {
    findings.push({
      check: "grounded_ratio",
      severity: "warning",
      detail: `only ${groundedPercent}% of line items are backed by anything checked`,
    });
  }

  const defectCount = findings.filter((f) => f.severity === "defect").length;
  return {
    findings,
    defectCount,
    warningCount: findings.length - defectCount,
    groundedPercent,
    itemCount,
    passed: defectCount === 0,
  };
}

/** Mirrors computeTrustScore in the frontend exactly — the same number the
 * traveler is shown, computed here so it can be recorded per job. Kept as
 * its own function so the two can be diffed if they ever drift. */
export function groundedRatio(itinerary: Itinerary): {
  groundedPercent: number;
  itemCount: number;
} {
  let grounded = 0;
  let total = 0;
  for (const day of itinerary.days ?? []) {
    for (const item of day.items) {
      total++;
      const searchGrounded = (item.confidence_tier ?? "inferred") !== "inferred";
      const placesGrounded = item.google_maps_url != null || item.google_rating != null;
      if (searchGrounded || placesGrounded) grounded++;
    }
  }
  return {
    groundedPercent: total === 0 ? 100 : Math.round((grounded / total) * 100),
    itemCount: total,
  };
}

function countNights(brief: TripBriefInput): number {
  const start = Date.parse(`${brief.start_date}T00:00:00Z`);
  const end = Date.parse(`${brief.end_date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

/** One line for the worker log — the whole report at a glance. */
export function summarizeQuality(report: QualityReport): string {
  const head = `${report.passed ? "PASS" : "FAIL"} ${report.defectCount} defect(s), ${report.warningCount} warning(s), ${report.groundedPercent}% grounded`;
  if (report.findings.length === 0) return head;
  return `${head} — ${report.findings.map((f) => f.detail).join("; ")}`;
}
