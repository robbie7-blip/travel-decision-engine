// The acceptance gate: what has to be true of an itinerary before a
// traveler is allowed to see it.
//
// Every quality failure this product has shipped has been the same bug
// wearing a different hat. Accommodation came back as "a mid-range hotel"
// with no property name. Days came back with no lunch and no dinner. Two
// days named the same cafe. Nineteen percent of line items were backed by
// anything. In each case the pipeline ran to completion, wrote "done" on
// the job, and served it - because nothing in it had an opinion about what
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
//      Anthropic client is. That split is what lets the gate run twice -
//      once to find work, once to confirm the work landed - without
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
// is a real weakness worth tracking that is not always fixable - a city
// with no hotel worth naming is a fact about the city, not a bug.

import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "../types";
// The report shape lives in jobs.ts because it travels ON the job to the
// frontend, exactly like JobTimings - declaring it twice is how the two
// sides drift.
import type {
  QualityCheckId,
  QualityFinding,
  QualityReport,
} from "../jobs";
export type { QualityCheckId, QualityFinding, QualityReport } from "../jobs";
import {
  requiredMeals,
  type MealSlot,
  type SkeletonAccommodation,
  type SkeletonDay,
} from "./twoPhase";

/** How far a lodging item's price may sit from the known per-night rate
 * before it is treated as wrong. Generous, because a day call is allowed to
 * round or to fold in a city tax - but nowhere near wide enough to let a
 * two-night total through as one night. */
const LODGING_PRICE_TOLERANCE = 0.35;

/** Forces every accommodation item onto the per-night rate we actually
 * looked up.
 *
 * A real generation priced a two-night Rome stay at EUR 264 and then wrote
 * EUR 264 on BOTH nights. The instruction is explicit - "cost_estimate_eur
 * is ONE night, never a multi-night total" - and it lost anyway, which is
 * what makes this worth enforcing rather than asking for. Accommodation is
 * the largest line in most trips and the trip total is summed from item
 * costs, so getting it wrong here silently doubles the number the traveler
 * is budgeting against. That is the worst kind of error this product can
 * make: confidently stated, expensive, and invisible.
 *
 * Deterministic on purpose. The correct figure is already known - it came
 * from the lodging lookup and was handed to the day call in its prompt - so
 * this is arithmetic, not a judgement, and it does not need a model call to
 * settle it. */
export function normalizeLodgingPrices(
  itinerary: Itinerary,
  accommodation: SkeletonAccommodation[]
): number {
  if (accommodation.length === 0) return 0;
  let corrected = 0;
  for (const day of itinerary.days ?? []) {
    for (const item of day.items) {
      if (item.type !== "lodging") continue;
      const rate = perNightRateFor(item, accommodation);
      if (rate == null || rate <= 0) continue;
      const actual = item.cost_estimate_eur;
      if (typeof actual !== "number" || actual <= 0) continue;
      if (Math.abs(actual - rate) / rate <= LODGING_PRICE_TOLERANCE) continue;
      item.cost_estimate_eur = Math.round(rate);
      corrected++;
    }
  }
  return corrected;
}

/** Matches a lodging item to its city's rate, falling back to the only
 * entry when there is just one - the same tolerance buildDayPrompt applies,
 * since the frame and the plan name cities independently. */
function perNightRateFor(
  item: ItineraryItem,
  accommodation: SkeletonAccommodation[]
): number | null {
  const location = (item.location ?? "").toLowerCase();
  const match = accommodation.find((a) => location.includes(a.city.toLowerCase().trim()));
  if (match) return match.cost_per_night_eur;
  return accommodation.length === 1 ? accommodation[0].cost_per_night_eur : null;
}

/** Below this, an itinerary is mostly guesswork wearing a confident face.
 * Not a defect, because it can be entirely legitimate (an obscure
 * destination with no curated facts and few venues Places knows), but
 * always worth surfacing - a sustained drop here is the earliest signal
 * that grounding has broken somewhere upstream. */
const MIN_GROUNDED_PERCENT = 40;

/** A day with fewer real things to do than this isn't a day, it's a gap.
 * Meals are excluded from the count on purpose: three meals and nothing
 * else is still an empty day.
 *
 * Two was one until a real Rome trip shipped a full day holding a single
 * activity - breakfast, lunch, one walk, dinner - which passed because one
 * activity cleared the bar. A day someone flew in for needs more than one
 * thing in it. Arrival and departure days are exempt: a flight legitimately
 * eats half of them. */
const MIN_ACTIVITIES_PER_FULL_DAY = 2;
const MIN_ACTIVITIES_PER_TRAVEL_DAY = 1;

/** Hours between consecutive items, during the part of the day someone is
 * actually awake and out, before the plan is treated as having a hole in it.
 *
 * This is not a demand that every hour be filled. Downtime is a legitimate
 * and often correct choice - but it has to be WRITTEN, as "afternoon at
 * leisure near the hotel" or similar, so the traveler knows it was a
 * decision rather than an omission. The same Rome day had a five-hour void
 * between breakfast and lunch and another five and a half between an
 * afternoon walk and dinner, with nothing said about either. */
const MAX_UNPLANNED_HOURS = 4;
// From breakfast, not from nine. A gap that opens at 08:00 and runs to
// lunch is five hours of someone's holiday, and starting the window at 9
// skipped exactly that case - which is the one the Rome day actually had.
const DAY_ACTIVE_FROM = 7;
const DAY_ACTIVE_UNTIL = 21;

/** Coarse per-person floors for what Google's price tier implies a meal
 * costs, in EUR. Deliberately well below what each tier really means, so
 * only a clear mismatch fires - the tiers are relative to a city, and an
 * expensive restaurant genuinely can be done cheaply at lunch. The cheap
 * tiers are absent on purpose: there is no floor to violate. */
/** Below this many minutes between arrival and closing, a ticketed
 * attraction is not really being visited. Deliberately modest - plenty of
 * small museums are an easy hour - so it flags the genuinely rushed rather
 * than second-guessing the pace. */
const MIN_VISIT_MINUTES = 75;

const MIN_PER_PERSON_EUR: Record<string, number | undefined> = {
  expensive: 30,
  very_expensive: 45,
};

/** Whether `haystack` refers to `wanted`, loosely enough to survive the
 * difference between how a traveler types a place and how an itinerary
 * writes it - "colosseum" against "Colosseum, Roman Forum and Palatine
 * Hill". Every word of the request that carries meaning has to appear;
 * short connectives are dropped so "the Trevi Fountain" and "Trevi
 * Fountain" match. */
const REQUEST_STOPWORDS = new Set([
  // Filtering by length alone kept "the", which made the check demand that
  // an itinerary contain the word "the" before it would accept that "the
  // Colosseum" had been included. Three letters is not the same as
  // meaningless, so the meaningless ones are named.
  "the", "and", "for", "with", "from", "into", "near", "our", "your", "its",
  "see", "visit", "visiting", "tour", "trip", "day", "days", "some", "any",
  "want", "would", "like", "must", "really", "definitely", "maybe",
]);

/** "a expensive venue" was appearing on the admin quality panel. Only the
 * five price-level words ever reach this, so vowel-initial is the whole
 * rule. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function mentions(haystack: string, wanted: string): boolean {
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !REQUEST_STOPWORDS.has(w));
  const words = normalize(wanted);
  if (words.length === 0) return true;
  const hay = new Set(normalize(haystack));
  const matched = words.filter((w) => hay.has(w)).length;

  // Every word, for one- and two-word requests - those are proper nouns and
  // dropping half of "Vatican Museums" would let any museum satisfy it.
  // For longer phrases, allow one word to go missing: people write
  // must-sees as descriptions ("Trevi Fountain at night", "the Colosseum
  // underground tour") and an itinerary that delivers the place without the
  // adjective has not dropped anything. Demanding all of it would report a
  // silent drop that did not happen, which is the failure mode this check
  // can least afford - a false alarm here trains you to ignore it.
  const needed = words.length <= 2 ? words.length : words.length - 1;
  return matched >= needed;
}

function isNamedVenueSlot(item: ItineraryItem): boolean {
  return item.type === "meal" || item.type === "activity";
}

function normalizeVenue(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Which meal a written item represents - same logic the meal repair uses,
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
  // "afternoon" first - it contains "noon", and testing noon first would
  // place every afternoon item at midday.
  if (t.includes("morning")) return 9;
  if (t.includes("afternoon")) return 15;
  if (t.includes("midday") || /\bnoon\b/.test(t)) return 13;
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
 * would have the pipeline "fix" night two by booking a different hotel -
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
 * meal check can't run - there is no way to tell a legitimately mealless
 * departure morning from a dropped lunch - so it's skipped rather than
 * guessed at, and the skip is itself reported so a run that lost its plan
 * doesn't look like a clean one. */
export function assessQuality(
  itinerary: Itinerary,
  brief: TripBriefInput,
  plan: SkeletonDay[],
  accommodation: SkeletonAccommodation[] = []
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
    const isTravelDay = day.items.some((i) => i.is_flight === true);
    const floor = isTravelDay ? MIN_ACTIVITIES_PER_TRAVEL_DAY : MIN_ACTIVITIES_PER_FULL_DAY;
    if (activities.length < floor) {
      findings.push({
        check: "day_not_empty",
        severity: "defect",
        day: day.day,
        detail: `day ${day.day} has ${activities.length} thing(s) to do across ${day.items.length} item(s)`,
      });
    }
  }

  // --- hours nobody accounted for --------------------------------------
  for (const day of days) {
    const times = day.items
      .filter((i) => i.type !== "lodging")
      .map((i) => parseHour(i.time))
      .filter((h): h is number => h != null)
      .sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const from = times[i - 1];
      const to = times[i];
      if (to - from <= MAX_UNPLANNED_HOURS) continue;
      // Only the waking, out-and-about part of the day - a gap that starts
      // at 21:00 is called an evening.
      if (from < DAY_ACTIVE_FROM || from > DAY_ACTIVE_UNTIL) continue;
      findings.push({
        check: "day_has_gap",
        severity: "warning",
        day: day.day,
        detail: `day ${day.day} has ${to - from} unaccounted hours between ${from}:00 and ${to}:00`,
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

  // --- accommodation priced per night, not per stay --------------------
  // normalizeLodgingPrices corrects these before the gate runs, so this
  // firing means a lodging item is off its known rate by more than rounding
  // AND could not be matched to a city - worth seeing, because the trip
  // total is summed from these.
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== "lodging") continue;
      const rate = perNightRateFor(item, accommodation);
      if (rate == null || rate <= 0) continue;
      const actual = item.cost_estimate_eur;
      if (typeof actual !== "number" || actual <= 0) continue;
      if (Math.abs(actual - rate) / rate <= LODGING_PRICE_TOLERANCE) continue;
      findings.push({
        check: "lodging_price_per_night",
        severity: "defect",
        day: day.day,
        detail: `day ${day.day} accommodation is EUR ${actual} against a per-night rate of EUR ${Math.round(rate)}`,
      });
    }
  }

  // --- meal prices against what Google says the place costs ------------
  // The model estimates a price before Places has said anything, so the two
  // are independent - which is what makes disagreement informative. A lunch
  // put at EUR 40 for two at a venue Google rates very expensive is not
  // wrong exactly, but it is the direction that matters: an understated
  // meal understates the trip total, and the total is what the traveler
  // budgets against. Only gross mismatches fire, because the bands are
  // coarse and a cheap dish at an expensive restaurant is a real thing.
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== "meal") continue;
      const floor = MIN_PER_PERSON_EUR[item.google_price_level ?? ""];
      if (floor == null) continue;
      const perPerson = item.cost_estimate_eur / Math.max(1, brief.party_size);
      if (perPerson >= floor) continue;
      findings.push({
        check: "price_matches_tier",
        severity: "warning",
        day: day.day,
        detail: `day ${day.day} "${item.title}" is EUR ${item.cost_estimate_eur} for ${brief.party_size} at ${article(item.google_price_level?.replace("_", " ") ?? "")} venue`,
      });
    }
  }

  // --- arrival/departure legs -----------------------------------------
  // A flight is not a complete arrival. Landing with no written way into
  // town is the moment in a trip where a traveler is least able to improvise,
  // and it is invisible in an itinerary that otherwise looks full.
  for (const day of days) {
    const hasFlight = day.items.some((i) => i.is_flight === true);
    if (!hasFlight) continue;
    const hasGroundLeg = day.items.some((i) => i.type === "transport" && i.is_flight !== true);
    if (hasGroundLeg) continue;
    findings.push({
      check: "transport_legs",
      severity: "warning",
      day: day.day,
      detail: `day ${day.day} has a flight but no way to or from the airport`,
    });
  }

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

  // --- open when we send them ------------------------------------------
  // Anything Google says is shut on the visit day should already have been
  // removed by checkVenues, so this firing means something got past that -
  // a repaired venue that failed its second pass, or an item whose time
  // moved after verification. Cheap to assert, and the failure it guards
  // against (a traveler standing outside a locked door) is the one this
  // product least survives.
  for (const day of days) {
    for (const item of day.items) {
      if (item.google_open_on_visit !== false) continue;
      findings.push({
        check: "open_on_visit",
        severity: "defect",
        day: day.day,
        detail: `day ${day.day} "${item.title}" is closed at that time on that day`,
      });
    }
  }

  // --- the things they actually asked for -------------------------------
  // must_see goes into the prompt and, until now, was never checked against
  // what came back. It is the single worst thing to lose: everything else
  // in an itinerary is our suggestion, and this is the traveler's own
  // requirement. Dropping it silently is the failure they are most likely
  // to notice and least likely to forgive.
  //
  // Being unable to fit one is allowed - the prompt says so - but only out
  // loud. So the narrative counts as coverage: a must-see explained away in
  // the summary, a key decision or the skip list has been handled, while
  // one that appears nowhere at all has been dropped.
  const narrative = [
    itinerary.trip_summary,
    ...(itinerary.key_decisions ?? []).flatMap((d) => [d.decision, d.reasoning]),
    ...(itinerary.things_to_skip ?? []).flatMap((s) => [s.item, s.reasoning]),
  ].join(" ");
  // location is in here because that is where a place name usually lands.
  // A real Rome trip asked for "Vatican City" and got the Vatican Museums,
  // the Sistine Chapel and St. Peter's Basilica, each with location
  // "Vatican City" - and this reported the must-see as dropped, because
  // "Vatican" was in the titles and "City" was only in the field it wasn't
  // reading. The traveler's own requirement was met three times over and
  // the gate called it the run's only defect.
  //
  // That is the exact failure this check says it can least afford: a false
  // alarm here trains you to ignore it.
  const itemText = days
    .flatMap((d) => d.items.flatMap((i) => [i.title, i.venue_name ?? "", i.location, i.reasoning]))
    .join(" ");
  for (const wanted of brief.must_see ?? []) {
    if (mentions(itemText, wanted) || mentions(narrative, wanted)) continue;
    findings.push({
      check: "must_see_covered",
      severity: "defect",
      detail: `"${wanted}" was asked for and appears nowhere, not even as something skipped`,
    });
  }

  // --- the budget stamp against the actual bill --------------------------
  // budget_feasibility is the model's own estimate. This is the arithmetic:
  // what the items in front of the traveler actually add up to. A trip
  // stamped "feasible" whose own line items exceed the stated budget is
  // contradicting itself on the page, and the sum is what people check.
  //
  // One-directional on purpose. Coming in under budget is not a defect, and
  // an item with no price (a flight priced by link rather than figure)
  // makes the sum an UNDER-estimate - so this only ever fires when the
  // total is over despite that, which makes a false positive very unlikely.
  const stated = brief.budget_total_eur ?? 0;
  if (stated > 0 && itinerary.budget_feasibility?.feasible === true) {
    const itemTotal = days.reduce(
      (sum, day) => sum + day.items.reduce((s, i) => s + (i.cost_estimate_eur || 0), 0),
      0
    );
    if (itemTotal > stated) {
      findings.push({
        check: "budget_matches_items",
        severity: "defect",
        detail: `marked feasible, but the items add up to EUR ${Math.round(itemTotal)} against a EUR ${stated} budget`,
      });
    }
  }

  // --- arriving with time to actually see it ----------------------------
  // The open_on_visit check asks whether the doors are open. This asks
  // whether there is any point walking through them. A real Rome trip put
  // the Colosseum, Roman Forum and Palatine Hill - three sites on one
  // ticket - at 15:30 against a 16:30 close, which passed as "open" and is
  // not a visit. Paid attractions also tend to stop admitting people before
  // they close, so an hour on the clock is usually less than an hour in
  // practice.
  //
  // Only ticketed activities. A cafe half an hour before closing is a
  // coffee, not a problem, and a free square has no closing time worth
  // worrying about.
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== "activity") continue;
      if (!(item.cost_estimate_eur > 0)) continue;
      const left = item.google_minutes_until_close;
      if (left == null || left >= MIN_VISIT_MINUTES) continue;
      findings.push({
        check: "time_to_visit",
        severity: "warning",
        day: day.day,
        detail: `day ${day.day} "${item.title}" starts ${left} min before closing`,
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

/** Mirrors computeTrustScore in the frontend exactly - the same number the
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
      // Mirrors trustScore.ts - a flight's Google Flights link is the same
      // kind of evidence as a venue's Maps link. Kept identical on purpose:
      // this number is recorded per job and the traveler is shown the other
      // one, and two definitions of "verified" would be worse than none.
      const flightGrounded = item.flight_search_url != null;
      if (searchGrounded || placesGrounded || flightGrounded) grounded++;
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

/** One line for the worker log - the whole report at a glance. */
export function summarizeQuality(report: QualityReport): string {
  const head = `${report.passed ? "PASS" : "FAIL"} ${report.defectCount} defect(s), ${report.warningCount} warning(s), ${report.groundedPercent}% grounded`;
  if (report.findings.length === 0) return head;
  return `${head} - ${report.findings.map((f) => f.detail).join("; ")}`;
}
