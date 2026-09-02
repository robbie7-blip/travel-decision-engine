// Parallel generation - the fix for generation wall-time being dominated by
// ONE model call streaming the entire itinerary's JSON out token by token.
//
// Phase 1 is itself two calls that run CONCURRENTLY (see TripFrame and
// TripPlan below). It used to be a single "skeleton" call, and on a long
// multi-city trip that one call was doing two genuinely separate jobs back
// to back: reasoning about the trip as a whole (is this budget real, what's
// worth skipping, where do they sleep) and laying out N days with named
// anchors. The second job grows with trip length, so a 10-day trip paid for
// both serially in the one place where nothing else can overlap.
//
// They don't actually depend on each other. The budget estimate is driven
// by nights, party size and city price level, not by which cafe anchors day
// six; the day layout is driven by the dates and the destinations, not by
// the wording of key_decisions. So they run side by side and are merged
// deterministically by mergeSkeleton. Phase 1's wall time becomes
// max(frame, plan) instead of their sum, which is the same trick phase 2
// already uses, applied to the stage that was left serial.
//
// The prior optimization rounds all attacked *search* latency (per-item
// searches removed, then lodging cut to one search per destination, then
// those searches lifted out of the conversation and parallelized in
// index.ts's prefetchLodging). Those were real, but they left the actual
// dominant cost untouched: a 5-day trip is ~30 itinerary items, and one
// call emitting all of them plus the trip-level fields is roughly 3,000+
// output tokens generated strictly sequentially. Output tokens are serial
// by nature - no amount of search tuning touches that, which is why
// generation stayed near-constant at ~90s even after search stopped being
// the bottleneck.
//
// So: split the work instead of shortening it.
//
//   Phase 1 (skeleton, one call): every decision that genuinely needs a
//   whole-trip view - budget feasibility, city order, which day is where,
//   accommodation choice per city, key decisions, things to skip, and a
//   per-day plan naming that day's anchor venues. Small output (~800-1200
//   tokens) because it names things without writing them up.
//
//   Phase 2 (days, N calls IN PARALLEL): each call expands exactly one
//   day's plan into full itinerary items. ~500-700 tokens each, and they
//   all run concurrently, so this phase costs max(day) rather than sum(days).
//
// Wall time goes from sum(everything) to skeleton + max(day). The quality
// bar is held by construction rather than by hoping: the day calls reuse
// the EXISTING SYSTEM_PROMPT verbatim (every venue-naming, hedging, tone,
// currency and schema rule applies to item writing exactly as it does
// today - see DAY_INSTRUCTIONS, which only redirects the output shape),
// and the hard reasoning that actually needs whole-trip context is done
// once, in the skeleton, not duplicated per day.
//
// Cross-day consistency - the real risk when N calls can't see each other
// - is handled three ways, deliberately NOT by making the skeleton name
// every venue in the trip. That was tried, and it moved the bulk of the
// naming work into the one serial call, which is the single worst place to
// put work: it roughly tripled generation time. Instead the skeleton names
// only each day's few load-bearing anchors and guarantees THOSE are unique,
// each day call is shown the other days' anchors and forbidden to reuse
// one, and dedupeVenuesAcrossDays below catches anything that still slips
// through, deterministically and for free.

import type {
  BudgetFeasibility,
  ItineraryItem,
  Itinerary,
  ItineraryDay,
  KeyDecision,
  SkipItem,
  TripBriefInput,
} from "../types";
import { buildContext } from "./prompt";

/** Phase 1's combined output. Deliberately mirrors the final Itinerary's
 * trip-level fields exactly (budget_feasibility/trip_summary/key_decisions/
 * things_to_skip pass straight through to the assembled result) so there's
 * no second vocabulary to translate between. Produced by mergeSkeleton from
 * the two halves below, which are generated concurrently. */
export interface TripSkeleton {
  budget_feasibility: BudgetFeasibility;
  trip_summary: string;
  key_decisions: KeyDecision[];
  things_to_skip: SkipItem[];
  accommodation: SkeletonAccommodation[];
  days: SkeletonDay[];
}

/** Phase 1A: the whole-trip judgement calls. Everything here is about the
 * trip as one object - is the budget real, what is worth skipping, where do
 * they sleep - and none of it grows with the number of days. */
export interface TripFrame {
  budget_feasibility: BudgetFeasibility;
  trip_summary: string;
  key_decisions: KeyDecision[];
  things_to_skip: SkipItem[];
  accommodation: SkeletonAccommodation[];
}

/** Phase 1B: the day-by-day layout. This is the half that grows with trip
 * length, which is exactly why it no longer shares a call with the frame. */
export interface TripPlan {
  days: SkeletonDay[];
}

export interface SkeletonAccommodation {
  city: string;
  /** Null when no specific property could be verified for this city - the
   * accommodation item then stays deliberately generic rather than being
   * given an invented hotel name. */
  name: string | null;
  area: string | null;
  cost_per_night_eur: number;
  source_confidence: "grounded" | "inferred";
  source_urls?: string[];
}

export interface SkeletonDay {
  day: number;
  date: string;
  city: string;
  theme: string;
  /** Whether this day ends with a night at the accommodation. The skeleton
   * decides it explicitly rather than each day call inferring "is there a
   * night after me" from dates it can only partially see - that inference
   * is exactly the kind of thing that silently produces N-1 or N+1 lodging
   * items once the days are written independently. */
  include_lodging: boolean;
  /** Real, specific, named venues assigned to this day, each with the slot
   * it fills, e.g. "Mocotó (dinner)". This is also the cross-day
   * de-duplication mechanism - see DAY_INSTRUCTIONS. */
  anchors: string[];
  /** Set only on the days that actually carry an arrival or departure leg. */
  transport_note?: string | null;
  /** Which meals this day owes, decided here because only this stage knows
   * the arrival and departure timing that makes a missing meal legitimate.
   *
   * This exists because "include every meal the day realistically needs" -
   * a rule the day call was given as prose - produced days with no lunch and
   * no dinner on a real trip. Written as a general instruction it competes
   * with "downtime that fits the stated pace", and on a relaxed brief the
   * pace wins. Written as an explicit list of slots this day owes, there is
   * nothing to weigh up. Defaults to all three when the plan omits it. */
  meals?: MealSlot[];
}

export type MealSlot = "breakfast" | "lunch" | "dinner";

const ALL_MEALS: MealSlot[] = ["breakfast", "lunch", "dinner"];

/** The meals a day owes, falling back to all three. A day is only allowed to
 * skip one because of travel timing, and the fallback deliberately errs
 * toward too many rather than too few: an extra lunch on a departure day is
 * a small annoyance, a full day with no midday meal is a hole. */
export function requiredMeals(day: SkeletonDay): MealSlot[] {
  const listed = (day.meals ?? []).filter((m): m is MealSlot => ALL_MEALS.includes(m));
  return listed.length > 0 ? listed : ALL_MEALS;
}

/** Rules both halves of phase 1 must follow identically. Kept in one place
 * rather than copied into each prompt: the frame and the plan are read by
 * the traveler as one document, and two drifting copies of the tone and
 * currency rules is how they stop sounding like one. */
const SHARED_PHASE1_RULES = `- Respect all hard constraints exactly (dietary, mobility, budget ceiling, hard_no).
- ALL prices are EUR, everywhere. Convert from any local currency yourself before writing a number.
- WRITING STYLE: write like a person texting a friend, not like an AI assistant. Never use an em \
dash. Short, plain sentences.
- TONE - CONFIDENT, NEVER ANXIOUS: never frame a tradeoff as "tension", "conflict", or "pressure". \
State how you handled it, not that a problem exists. Real constraints (an infeasible budget, a \
hard_no conflict) still get stated plainly and matter-of-factly.
- Output ONLY valid JSON matching the schema. No prose outside the JSON. No trailing commas.`;

const FRAME_SYSTEM = `You are a travel decision engine. This is STAGE 1A: the whole-trip judgement \
calls. A separate stage lays out the individual days and a later one writes them up, so do NOT \
produce any day-by-day content here.

Decide, and be opinionated about it - this is where the real calls get made:
- Whether the stated budget is actually realistic (mandatory, see below).
- Where the traveler stays in each city.
- What's worth skipping, and the handful of decisions worth explaining.

Rules:
- BUDGET FEASIBILITY IS MANDATORY AND MUST BE HONEST: independently estimate a realistic MINIMUM \
total for this trip, including accommodation for every night (unless the brief says accommodation \
is already arranged, in which case exclude it entirely). Compare that to the stated budget. Never \
quietly shrink or drop a real cost category to make the numbers appear to fit - if the honest \
minimum breaks the budget, say so plainly, that IS the correct finding.
- You are not told how the nights split between the cities, because that is decided in parallel \
with this. The trip's total number of nights is fixed by the dates you were given, and that plus \
each city's price level is what the estimate actually turns on, so split them sensibly yourself \
and estimate from that.
- ACCOMMODATION: one entry per city, with "city" spelled exactly as the brief spells that \
destination, character for character. Give its real per-night cost in EUR. If the context below \
supplies a SPECIFIC PROPERTY for a city, use that exact property name and area, reuse that exact \
price and its source_urls, and set source_confidence "grounded" - do not substitute a different \
hotel or downgrade it to a generic "mid-range hotel". If the context supplies a verified price but \
no specific property, set name to null and keep source_confidence "grounded" (the price is still \
verified, just not the property). If neither is supplied, give your best hedged price estimate, set \
name null and source_confidence "inferred" with no source_urls. NEVER invent a property name that \
wasn't supplied to you - accommodation is the biggest line item in most trips, and a fabricated \
hotel is the worst possible place to be wrong. If the brief says accommodation is already arranged, \
return an empty accommodation array.
- Treat must-see/must-do items as near-mandatory. If one is genuinely infeasible, say so explicitly \
in trip_summary and in a key_decisions entry rather than silently dropping it.
- If any preferences are in direct tension (a packed pace plus mandatory long rests, a long \
interest list on a short trip), say so explicitly in trip_summary and a key_decisions entry \
instead of silently complying with each in isolation.
- LENGTH: each key_decisions reasoning is <=15 words, alternative_considered is a few words not a \
sentence. Each things_to_skip reasoning is <=15 words. key_decisions is normally 3-6 entries (the \
genuinely load-bearing calls only), things_to_skip 2-4. budget_feasibility.reasoning may run to two \
sentences if the math genuinely needs it.
${SHARED_PHASE1_RULES}

Schema:
{
  "budget_feasibility": {
    "feasible": true or false,
    "min_realistic_total_eur": 0,
    "reasoning": "your minimum estimate and whether the stated budget is realistic, noting explicitly if any cost category had to be excluded"
  },
  "trip_summary": "one confident, appealing sentence about the trip itself - never mention data verification or confidence here. Only exception: if the budget is genuinely infeasible, say so plainly",
  "key_decisions": [
    {"decision": "...", "reasoning": "<=15 words", "alternative_considered": "a few words", "confidence": "high|medium|low"}
  ],
  "accommodation": [
    {"city": "...", "name": "the exact property name you were supplied, or null if none was", "area": "neighborhood", "cost_per_night_eur": 0, "source_confidence": "grounded|inferred", "source_urls": []}
  ],
  "things_to_skip": [
    {"item": "...", "reasoning": "<=15 words"}
  ]
}`;

const PLAN_SYSTEM = `You are a travel decision engine. This is STAGE 1B: lay out the days. A \
separate stage handles the budget, accommodation and trip-level decisions, and a later one writes \
each day up in full, so produce ONLY the day plan here.

Decide:
- Which city gets which days, and in what order.
- What each day is about.
- Which specific, real, named venues anchor each day.
- Which meals each day owes.

Rules:
- ANCHORS ARE THE FEW LOAD-BEARING VENUES OF THE DAY, not everything in it: the 2-4 places that decide what \
the day IS (the sight it's built around, the one dinner worth planning). The expansion stage fills in the rest \
itself - the other meals, the coffee stop, the walk between two of them.
- Anchors must be real, specific, named businesses: "Mocotó (dinner)", not "a churrascaria (dinner)". Name your \
single best real candidate even when you can't confirm current hours or prices. Genuinely generic activities with \
no business to name (a walk through a neighborhood, a rest at the accommodation) need no anchor.
- NEVER REPEAT AN ANCHOR ACROSS DAYS: each named venue appears on exactly ONE day.
- Match the anchor count to the stated pace: relaxed means fewer, packed means more. Keep this list SHORT - it is \
a plan, not the itinerary, and every extra entry here is time the traveler spends waiting.
- Assign each must-see/must-do item to a specific day.
- "city" must be one of the destinations exactly as the brief spells it, character for character.
- MEALS: list the meals that day genuinely owes, out of "breakfast", "lunch", "dinner". A normal \
full day owes all three. Drop one ONLY when travel timing actually removes it: no breakfast if they \
land or set off before it, no lunch if they land mid-afternoon, no dinner if they fly out at 16:00. \
A relaxed pace is NOT a reason to drop a meal - people eat lunch on relaxed days too. Never return \
an empty list.
- include_lodging: true for every day the traveler actually spends the night at the accommodation, \
false for the final departure day (and any day they're in transit overnight). The number of true \
values must equal the number of nights in the trip. If the brief says accommodation is already \
arranged, set include_lodging false on every day.
- transport_note: set it ONLY on the arrival day and the departure day, and only when the brief \
gives an origin AND doesn't say the flight/train is already booked - one short line naming the \
specific mode and route, e.g. "Flight from Sofia to Chisinau". Commit to ONE mode, never "X or Y". \
Leave it null on every other day.
- LENGTH: theme is a short phrase, not a sentence.
${SHARED_PHASE1_RULES}

Schema:
{
  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "city": "which destination this day is in",
      "theme": "short phrase",
      "include_lodging": true,
      "anchors": ["Real Venue Name (dinner)", "Real Venue Name (afternoon)"],
      "meals": ["breakfast", "lunch", "dinner"],
      "transport_note": null
    }
  ]
}`;

export function getFrameSystemPrompt(): string {
  return FRAME_SYSTEM;
}

export function getPlanSystemPrompt(): string {
  return PLAN_SYSTEM;
}

export function buildFramePrompt(
  brief: TripBriefInput,
  cachedLodgingFacts?: Record<string, string>
): string {
  const { tripBlock, factsBlock, warning } = buildContext(brief, cachedLodgingFacts);

  return `Trip brief:
${tripBlock}

${factsBlock}
${warning}
Produce the STAGE 1A frame now, as JSON matching the schema in your instructions.`;
}

export function buildPlanPrompt(brief: TripBriefInput): string {
  // No cached lodging facts here on purpose: the plan decides day order and
  // anchors, and lodging prices are the frame's business. Sending them to
  // both halves would just re-pay the same input tokens twice.
  const { tripBlock, factsBlock, warning } = buildContext(brief);

  return `Trip brief:
${tripBlock}

${factsBlock}
${warning}
Produce the STAGE 1B day plan now, as JSON matching the schema in your instructions. Cover every \
day from ${brief.start_date} to ${brief.end_date} inclusive, numbered from 1.`;
}

/** Joins the two concurrently-generated halves of phase 1. Pure data
 * assembly with no reconciliation logic, because there is nothing to
 * reconcile: the two calls own disjoint fields by construction. The one
 * place they meet is the city name, which both take verbatim from the
 * brief's destinations, and every lookup against it downstream is already
 * case- and whitespace-insensitive. */
export function mergeSkeleton(frame: TripFrame, plan: TripPlan): TripSkeleton {
  return {
    budget_feasibility: frame.budget_feasibility,
    trip_summary: frame.trip_summary,
    key_decisions: frame.key_decisions ?? [],
    things_to_skip: frame.things_to_skip ?? [],
    accommodation: frame.accommodation ?? [],
    days: [...plan.days].sort((a, b) => a.day - b.day),
  };
}

/** Appended after the existing SYSTEM_PROMPT for a day call, as its own
 * cache_control block. SYSTEM_PROMPT is reused verbatim and on purpose:
 * every rule that governs how an item is written today - name a real venue,
 * hedge once, EUR only, confident tone, the exact item field shapes - has to
 * apply identically here, and the surest way to guarantee that is to not
 * restate any of it. This block only redirects the OUTPUT SHAPE (one day,
 * not a whole itinerary) and adds the cross-day constraints a call that can
 * only see its own day would otherwise have no way to respect. */
const DAY_INSTRUCTIONS = `STAGE 2 - WRITE EXACTLY ONE DAY.

Everything above still applies to how you write each item (naming real specific venues, hedging \
once, EUR only, confident tone, the exact item fields). Only the output SHAPE changes: you are \
expanding ONE already-planned day, not generating a whole itinerary.

START WITH THE MEALS. You are told exactly which meals this day owes. Write those items FIRST, \
before anything else, then build the rest of the day around them. This ordering is not cosmetic: a \
day written sights-first reliably runs out of momentum and arrives at the end having quietly \
dropped its dinner, which is the single most common way this stage fails.

Output ONLY this JSON object - no trip_summary, no key_decisions, no things_to_skip, no \
budget_feasibility, no other days:
{
  "day": <the day number you were given>,
  "date": "YYYY-MM-DD",
  "meals_covered": ["breakfast", "lunch", "dinner"],
  "items": [ ...items, exactly the item shape from the schema above... ],
  "feasibility_flag": null or a short note if this specific day is logistically too tight
}

"meals_covered" must list every meal slot you were asked for, and each one must have a real item in \
"items" to match. Fill it in LAST, by reading back your own items and checking each required meal is \
actually there. If a slot you were asked for is missing, go back and add it before you answer. This \
field exists so you check your own work rather than assuming it is complete.

Stage 1 already made the whole-trip decisions. Hold to them:
- Build the day around the anchors you're given. Each one becomes an item, at a sensible time, in \
a sensible order. Keep those venue names exactly as given.
- Then fill in the rest of the day yourself: the meals the anchors don't already cover, a coffee or \
snack stop, getting between places, downtime that fits the stated pace. Name real specific venues \
for these exactly as the rules above require - this is your day to write.
- ACCOUNT FOR THE WHOLE DAY. Read your finished items in time order and check there is no stretch of \
four hours or more between them while the traveler is up and out. Downtime is a fine answer and often \
the right one, but WRITE IT - "afternoon at leisure around the hotel", "slow wander back through the \
old town" - so it reads as a decision rather than as a day you stopped planning halfway through. A \
full day needs at least two real things in it beyond the meals; an arrival or departure day can have \
one, because the flight takes the rest.
- MEALS ARE NOT OPTIONAL: you are given the exact list of meals this day owes. Every one of them \
MUST appear as its own item, at a real named venue, even on a relaxed day and even when the anchors \
already fill the day. The travel timing that would justify dropping one has already been accounted \
for in that list, so there is nothing left for you to weigh up: if lunch is listed, the day has \
lunch. A day missing a listed meal is a hole in the itinerary, not a stylistic choice.
- NEVER name a venue listed under "Anchors used on OTHER days" - those belong to another day and \
would read to the traveler as the same place twice.
- ACCOMMODATION: include exactly one item with type "lodging" if and only if you are told to \
include it for this day, using the accommodation name, area and per-night cost you're given. Its \
cost_estimate_eur is ONE night, never a multi-night total. Copy the given source_confidence and \
source_urls onto it exactly. In human-readable text always call it "accommodation", never \
"lodging" (that word is only the JSON type key). Only the FIRST night in a city is a check-in - on \
later nights at the same place write it as another night there, never "check in" again.
- TRANSPORT: include an arrival or departure transport item only if you're given a transport note \
for this day, and follow it exactly, including the mode it commits to.
- GETTING FROM AND TO THE AIRPORT IS PART OF THE DAY. A flight item is not a complete arrival: on \
an arrival day also include the onward leg from the airport or station to the accommodation, and on \
a departure day the leg back out to it. Name the actual mode and give it a real cost (airport \
train, bus, taxi - whichever genuinely makes sense for that city, that hour and that much luggage). \
Landing at an airport with no way into town written down is a hole in the plan, and it is the point \
in a trip where a traveler is least able to work it out for themselves.
- Do not re-explain trip-level tradeoffs here. This day's items only.`;

export function getDayInstructions(): string {
  return DAY_INSTRUCTIONS;
}

/** Everything a day call needs from the rest of the trip. Deliberately NOT
 * the whole skeleton: a day needs the plan (its own anchors, the other
 * days' anchors, whether it is the first night in this city) and where the
 * traveler sleeps. It does not need the budget verdict, the key decisions
 * or the things-to-skip list - none of which appear in a day's output.
 *
 * Naming that dependency exactly is what lets phase 2 start as soon as the
 * PLAN is ready instead of waiting for both halves of phase 1. The frame is
 * the heavier of the two (it does the budget reasoning), so waiting for it
 * was pure blocked time on the critical path. */
export interface DayContext {
  days: SkeletonDay[];
  accommodation: SkeletonAccommodation[];
  /** Omitted when the frame hasn't resolved yet - it is context only, and
   * the day is explicitly told not to repeat it. */
  tripSummary?: string;
}

export function buildDayPrompt(
  brief: TripBriefInput,
  skeleton: DayContext,
  day: SkeletonDay
): string {
  // Only this day's city's facts - the other destinations' curated facts
  // are irrelevant to writing this day and would otherwise be re-sent on
  // every parallel day call.
  const { tripBlock, factsBlock, warning } = buildContext(brief, undefined, day.city);

  // The frame and the plan name the cities independently (they run
  // concurrently and neither sees the other's output), so a city that reads
  // the same to a person can differ by an accent or a suffix. A miss here
  // is expensive out of all proportion to its cause: the day is told to
  // include no accommodation, and a night silently vanishes from the trip's
  // cost. Hence the fallback for the single-accommodation case, where there
  // is no ambiguity about which entry was meant.
  const accommodation =
    skeleton.accommodation.find(
      (a) => a.city.toLowerCase().trim() === day.city.toLowerCase().trim()
    ) ?? (skeleton.accommodation.length === 1 ? skeleton.accommodation[0] : undefined);

  const otherAnchors = skeleton.days
    .filter((d) => d.day !== day.day)
    .flatMap((d) => d.anchors);

  const lines: string[] = [
    `Trip brief:`,
    tripBlock,
    ``,
    factsBlock,
    warning,
    `The whole-trip plan is already decided. Your job is day ${day.day} only.`,
    ``,
    `Day ${day.day} - ${day.date}`,
    `City: ${day.city}`,
    `Theme: ${day.theme}`,
    `Anchors for THIS day (each becomes an item, names exactly as written): ${
      day.anchors.length ? day.anchors.join("; ") : "(none - build the day from the theme)"
    }`,
    `Meals this day MUST include, each as its own item at a real named venue: ${requiredMeals(day).join(
      ", "
    )}. Any anchor already marked with one of those slots covers that meal; write the rest yourself.`,
  ];

  if (day.transport_note) {
    lines.push(`Transport for this day (include it, follow it exactly): ${day.transport_note}`);
  } else {
    lines.push(`Transport: no arrival/departure leg on this day - do not invent one.`);
  }

  if (day.include_lodging && accommodation) {
    const where = accommodation.name
      ? `${accommodation.name}${accommodation.area ? `, ${accommodation.area}` : ""} - use this exact ` +
        `property name in the title AND in venue_name, do not substitute a generic description`
      : `no specific property was verified for this city, so keep it generic and set venue_name to ` +
        `null - do NOT invent a hotel name`;
    // Whether this is the arrival night is a fact about the plan, not a
    // judgement, so it's computed here rather than left to a call that can
    // only see its own day. Without it every night in a city independently
    // decides it is a check-in, and the traveler reads "Check in to the
    // hotel" three mornings running.
    const isFirstNight =
      skeleton.days
        .filter((d) => d.include_lodging && d.city.toLowerCase().trim() === day.city.toLowerCase().trim())
        .sort((a, b) => a.day - b.day)[0]?.day === day.day;
    lines.push(
      `Accommodation (include exactly one "lodging" item for this night): ${where}. ` +
        `€${accommodation.cost_per_night_eur} for this one night, ` +
        `source_confidence "${accommodation.source_confidence}", source_urls ` +
        `${JSON.stringify(accommodation.source_urls ?? [])}. ` +
        (isFirstNight
          ? `This is the FIRST night in ${day.city}, so this item is the check-in.`
          : `This is NOT the first night in ${day.city} - they are already checked in, so write it ` +
            `as another night there and never as a check-in or arrival.`)
    );
  } else {
    lines.push(
      `Accommodation: do NOT include any "lodging" item on this day (${
        day.include_lodging ? "no accommodation was set for this city" : "no night is spent here"
      }).`
    );
  }

  if (otherAnchors.length > 0) {
    lines.push(
      `Anchors used on OTHER days - never name any of these here: ${otherAnchors.join("; ")}`
    );
  }

  if (skeleton.tripSummary) {
    lines.push(``, `Trip summary for context (do not repeat it in your output): ${skeleton.tripSummary}`);
  }
  lines.push(
    ``,
    `Write day ${day.day} now, as the single JSON day object described in your instructions.`
  );

  return lines.join("\n");
}

/** Fallback used only when a replacement couldn't be found - strips the
 * venue identity so nothing downstream treats it as verified, keeping the
 * item so the day doesn't lose a meal outright. */
export function stripVenueIdentity(item: ItineraryItem): void {
  item.venue_name = null;
}

/** Stitches phase 1's trip-level fields together with phase 2's independently
 * generated days. Days are sorted by number rather than trusting the order
 * the parallel calls happened to resolve in. */
export function assembleItinerary(skeleton: TripSkeleton, days: ItineraryDay[]): Itinerary {
  return {
    budget_feasibility: skeleton.budget_feasibility,
    trip_summary: skeleton.trip_summary,
    key_decisions: skeleton.key_decisions ?? [],
    days: [...days].sort((a, b) => a.day - b.day),
    things_to_skip: skeleton.things_to_skip ?? [],
  };
}

/** Structural sanity checks before we commit to a parallel-path result.
 * Anything failing here means falling back to the single-call path rather
 * than shipping a half-formed itinerary - the whole point of this being an
 * optimization is that it can't cost correctness. */
export function isUsableFrame(frame: unknown): frame is TripFrame {
  if (!frame || typeof frame !== "object") return false;
  const f = frame as Partial<TripFrame>;
  if (!f.budget_feasibility || typeof f.trip_summary !== "string") return false;
  return Array.isArray(f.accommodation);
}

export function isUsablePlan(plan: unknown): plan is TripPlan {
  if (!plan || typeof plan !== "object") return false;
  const p = plan as Partial<TripPlan>;
  if (!Array.isArray(p.days) || p.days.length === 0) return false;
  return p.days.every(
    (d) => typeof d?.day === "number" && typeof d?.date === "string" && Array.isArray(d?.anchors)
  );
}

/** Overlays a live-verified accommodation onto the skeleton's own estimate,
 * for the case where the lodging lookup ran CONCURRENTLY with phase 1 and
 * therefore wasn't available when the skeleton made its guess.
 *
 * Running those two at the same time removes a whole serial stage from the
 * critical path, but it means phase 1 priced accommodation from general
 * knowledge. The real figure is strictly better, so it wins - and because
 * accommodation is usually the largest line in the trip, the trip-level
 * budget minimum is corrected by the same delta rather than being left
 * quietly inconsistent with the items underneath it. Deterministic
 * arithmetic, not another model call: the number has to agree with the
 * items, and that's a calculation, not a judgement. */
export function applyVerifiedAccommodation(
  skeleton: { days: SkeletonDay[]; accommodation: SkeletonAccommodation[]; budget_feasibility?: BudgetFeasibility },
  city: string,
  // costPerNightEur is null when the rate search missed but the property
  // search didn't. The two halves are separate searches and fail
  // separately, so the name is applied on its own rather than being
  // discarded along with the missing price.
  verified: {
    costPerNightEur: number | null;
    name: string | null;
    area: string | null;
    sourceUrls: string[];
  }
): void {
  const nights = skeleton.days.filter(
    (d) => d.include_lodging && d.city.toLowerCase().trim() === city.toLowerCase().trim()
  ).length;

  const existing = skeleton.accommodation.find(
    (a) => a.city.toLowerCase().trim() === city.toLowerCase().trim()
  );
  const previousPerNight = existing?.cost_per_night_eur ?? 0;
  const hasPrice = verified.costPerNightEur != null;

  const next: SkeletonAccommodation = {
    city: existing?.city ?? city,
    name: verified.name ?? existing?.name ?? null,
    area: verified.area ?? existing?.area ?? null,
    cost_per_night_eur: verified.costPerNightEur ?? previousPerNight,
    // "grounded" is a claim about the PRICE having a source, so it only
    // holds when a price actually came back. A named property with the
    // frame's own estimate behind it is still an estimate, and saying
    // otherwise would put a verified badge on an unverified number.
    source_confidence: hasPrice ? "grounded" : (existing?.source_confidence ?? "inferred"),
    source_urls: hasPrice ? verified.sourceUrls : (existing?.source_urls ?? []),
  };
  if (existing) Object.assign(existing, next);
  else skeleton.accommodation.push(next);

  // Only correctable once the frame exists - when accommodation is applied
  // before it (the fast path), the caller re-applies against the real
  // budget as soon as the frame lands.
  if (hasPrice && nights > 0 && previousPerNight > 0 && skeleton.budget_feasibility) {
    const delta = (verified.costPerNightEur! - previousPerNight) * nights;
    skeleton.budget_feasibility.min_realistic_total_eur = Math.max(
      0,
      Math.round(skeleton.budget_feasibility.min_realistic_total_eur + delta)
    );
  }
}
