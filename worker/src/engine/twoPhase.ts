// Two-phase parallel generation — the fix for generation wall-time being
// dominated by ONE model call streaming the entire itinerary's JSON out
// token by token.
//
// The prior optimization rounds all attacked *search* latency (per-item
// searches removed, then lodging cut to one search per destination, then
// those searches lifted out of the conversation and parallelized in
// index.ts's prefetchLodging). Those were real, but they left the actual
// dominant cost untouched: a 5-day trip is ~30 itinerary items, and one
// call emitting all of them plus the trip-level fields is roughly 3,000+
// output tokens generated strictly sequentially. Output tokens are serial
// by nature — no amount of search tuning touches that, which is why
// generation stayed near-constant at ~90s even after search stopped being
// the bottleneck.
//
// So: split the work instead of shortening it.
//
//   Phase 1 (skeleton, one call): every decision that genuinely needs a
//   whole-trip view — budget feasibility, city order, which day is where,
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
// today — see DAY_INSTRUCTIONS, which only redirects the output shape),
// and the hard reasoning that actually needs whole-trip context is done
// once, in the skeleton, not duplicated per day.
//
// Cross-day consistency — the real risk when N calls can't see each other
// — is handled three ways, deliberately NOT by making the skeleton name
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

/** Phase 1's output. Deliberately mirrors the final Itinerary's trip-level
 * fields exactly (budget_feasibility/trip_summary/key_decisions/
 * things_to_skip pass straight through to the assembled result) so there's
 * no second vocabulary to translate between. */
export interface TripSkeleton {
  budget_feasibility: BudgetFeasibility;
  trip_summary: string;
  key_decisions: KeyDecision[];
  things_to_skip: SkipItem[];
  accommodation: SkeletonAccommodation[];
  days: SkeletonDay[];
}

export interface SkeletonAccommodation {
  city: string;
  /** Null when no specific property could be verified for this city — the
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
   * night after me" from dates it can only partially see — that inference
   * is exactly the kind of thing that silently produces N-1 or N+1 lodging
   * items once the days are written independently. */
  include_lodging: boolean;
  /** Real, specific, named venues assigned to this day, each with the slot
   * it fills, e.g. "Mocotó (dinner)". This is also the cross-day
   * de-duplication mechanism — see DAY_INSTRUCTIONS. */
  anchors: string[];
  /** Set only on the days that actually carry an arrival or departure leg. */
  transport_note?: string | null;
}

const SKELETON_SYSTEM = `You are a travel decision engine, planning a trip in two stages. This is STAGE 1: \
make every decision that needs a view of the WHOLE trip, but do NOT write the detailed day-by-day \
itinerary yet (a later stage expands each day).

Decide, and be opinionated about it — this is the stage where the real calls get made:
- Which city gets which days, and in what order.
- Whether the stated budget is actually realistic (mandatory, see below).
- Where the traveler stays in each city.
- Which specific, real, named venues anchor each day.
- What's worth skipping, and the handful of decisions worth explaining.

Rules:
- BUDGET FEASIBILITY IS MANDATORY AND MUST BE HONEST: independently estimate a realistic MINIMUM \
total for this trip, including accommodation for every night (unless the brief says accommodation \
is already arranged, in which case exclude it entirely). Compare that to the stated budget. Never \
quietly shrink or drop a real cost category to make the numbers appear to fit — if the honest \
minimum breaks the budget, say so plainly, that IS the correct finding.
- ANCHORS ARE THE FEW LOAD-BEARING VENUES OF THE DAY, not everything in it: the 2-4 places that decide what \
the day IS (the sight it's built around, the one dinner worth planning). The expansion stage fills in the rest \
itself — the other meals, the coffee stop, the walk between two of them.
- Anchors must be real, specific, named businesses: "Mocotó (dinner)", not "a churrascaria (dinner)". Name your \
single best real candidate even when you can't confirm current hours or prices. Genuinely generic activities with \
no business to name (a walk through a neighborhood, a rest at the accommodation) need no anchor.
- NEVER REPEAT AN ANCHOR ACROSS DAYS: each named venue appears on exactly ONE day.
- Match the anchor count to the stated pace: relaxed means fewer, packed means more. Keep this list SHORT — it is \
a plan, not the itinerary, and every extra entry here is time the traveler spends waiting.
- Respect all hard constraints exactly (dietary, mobility, budget ceiling, hard_no). Treat \
must-see/must-do items as near-mandatory — assign each to a specific day. If one is genuinely \
infeasible, say so explicitly in trip_summary and in a key_decisions entry rather than silently \
dropping it.
- If any preferences are in direct tension (a packed pace plus mandatory long rests, a long \
interest list on a short trip), say so explicitly in trip_summary and a key_decisions entry \
instead of silently complying with each in isolation.
- ACCOMMODATION: one entry per city, with its real per-night cost in EUR. If the context below \
supplies a SPECIFIC PROPERTY for a city, use that exact property name and area, reuse that exact \
price and its source_urls, and set source_confidence "grounded" — do not substitute a different \
hotel or downgrade it to a generic "mid-range hotel". If the context supplies a verified price but \
no specific property, set name to null and keep source_confidence "grounded" (the price is still \
verified, just not the property). If neither is supplied, give your best hedged price estimate, set \
name null and source_confidence "inferred" with no source_urls. NEVER invent a property name that \
wasn't supplied to you — accommodation is the biggest line item in most trips, and a fabricated \
hotel is the worst possible place to be wrong. If the brief says accommodation is already arranged, \
return an empty accommodation array and set include_lodging false on every day.
- include_lodging: true for every day the traveler actually spends the night at the accommodation, \
false for the final departure day (and any day they're in transit overnight). The number of true \
values must equal the number of nights in the trip.
- transport_note: set it ONLY on the arrival day and the departure day, and only when the brief \
gives an origin AND doesn't say the flight/train is already booked — one short line naming the \
specific mode and route, e.g. "Flight from Sofia to Chisinau". Commit to ONE mode, never "X or Y". \
Leave it null on every other day.
- ALL prices are EUR, everywhere. Convert from any local currency yourself before writing a number.
- WRITING STYLE: write like a person texting a friend, not like an AI assistant. Never use an em \
dash. Short, plain sentences.
- TONE — CONFIDENT, NEVER ANXIOUS: never frame a tradeoff as "tension", "conflict", or "pressure". \
State how you handled it, not that a problem exists. Real constraints (an infeasible budget, a \
hard_no conflict) still get stated plainly and matter-of-factly.
- LENGTH: theme is a short phrase. Each key_decisions reasoning is <=15 words, \
alternative_considered is a few words not a sentence. Each things_to_skip reasoning is <=15 words. \
key_decisions is normally 3-6 entries (the genuinely load-bearing calls only), things_to_skip 2-4. \
budget_feasibility.reasoning may run to two sentences if the math genuinely needs it.
- Output ONLY valid JSON matching the schema. No prose outside the JSON. No trailing commas.

Schema:
{
  "budget_feasibility": {
    "feasible": true or false,
    "min_realistic_total_eur": 0,
    "reasoning": "your minimum estimate and whether the stated budget is realistic, noting explicitly if any cost category had to be excluded"
  },
  "trip_summary": "one confident, appealing sentence about the trip itself — never mention data verification or confidence here. Only exception: if the budget is genuinely infeasible, say so plainly",
  "key_decisions": [
    {"decision": "...", "reasoning": "<=15 words", "alternative_considered": "a few words", "confidence": "high|medium|low"}
  ],
  "accommodation": [
    {"city": "...", "name": "the exact property name you were supplied, or null if none was", "area": "neighborhood", "cost_per_night_eur": 0, "source_confidence": "grounded|inferred", "source_urls": []}
  ],
  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "city": "which destination this day is in",
      "theme": "short phrase",
      "include_lodging": true,
      "anchors": ["Real Venue Name (dinner)", "Real Venue Name (afternoon)"],
      "transport_note": null
    }
  ],
  "things_to_skip": [
    {"item": "...", "reasoning": "<=15 words"}
  ]
}`;

export function getSkeletonSystemPrompt(): string {
  return SKELETON_SYSTEM;
}

export function buildSkeletonPrompt(
  brief: TripBriefInput,
  cachedLodgingFacts?: Record<string, string>
): string {
  const { tripBlock, factsBlock, warning } = buildContext(brief, cachedLodgingFacts);

  return `Trip brief:
${tripBlock}

${factsBlock}
${warning}
Produce the STAGE 1 plan now, as JSON matching the schema in your instructions. Cover every day \
from ${brief.start_date} to ${brief.end_date} inclusive, numbered from 1.`;
}

/** Appended after the existing SYSTEM_PROMPT for a day call, as its own
 * cache_control block. SYSTEM_PROMPT is reused verbatim and on purpose:
 * every rule that governs how an item is written today — name a real venue,
 * hedge once, EUR only, confident tone, the exact item field shapes — has to
 * apply identically here, and the surest way to guarantee that is to not
 * restate any of it. This block only redirects the OUTPUT SHAPE (one day,
 * not a whole itinerary) and adds the cross-day constraints a call that can
 * only see its own day would otherwise have no way to respect. */
const DAY_INSTRUCTIONS = `STAGE 2 — WRITE EXACTLY ONE DAY.

Everything above still applies to how you write each item (naming real specific venues, hedging \
once, EUR only, confident tone, the exact item fields). Only the output SHAPE changes: you are \
expanding ONE already-planned day, not generating a whole itinerary.

Output ONLY this JSON object — no trip_summary, no key_decisions, no things_to_skip, no \
budget_feasibility, no other days:
{
  "day": <the day number you were given>,
  "date": "YYYY-MM-DD",
  "items": [ ...items, exactly the item shape from the schema above... ],
  "feasibility_flag": null or a short note if this specific day is logistically too tight
}

Stage 1 already made the whole-trip decisions. Hold to them:
- Build the day around the anchors you're given. Each one becomes an item, at a sensible time, in \
a sensible order. Keep those venue names exactly as given.
- Then fill in the rest of the day yourself: the meals the anchors don't already cover, a coffee or \
snack stop, getting between places, downtime that fits the stated pace. Name real specific venues \
for these exactly as the rules above require — this is your day to write.
- EVERY MEAL THE DAY REALISTICALLY NEEDS MUST BE THERE: breakfast, lunch AND dinner on a full day, \
adjusted only for arrival/departure timing (no lunch if they land mid-afternoon, no dinner if they \
fly out at 16:00). A full day with no midday meal is a hole in the itinerary, not a stylistic \
choice — do not skip one to keep the day looking relaxed.
- NEVER name a venue listed under "Anchors used on OTHER days" — those belong to another day and \
would read to the traveler as the same place twice.
- ACCOMMODATION: include exactly one item with type "lodging" if and only if you are told to \
include it for this day, using the accommodation name, area and per-night cost you're given. Its \
cost_estimate_eur is ONE night, never a multi-night total. Copy the given source_confidence and \
source_urls onto it exactly. In human-readable text always call it "accommodation", never \
"lodging" (that word is only the JSON type key).
- TRANSPORT: include an arrival or departure transport item only if you're given a transport note \
for this day, and follow it exactly, including the mode it commits to.
- Do not re-explain trip-level tradeoffs here. This day's items only.`;

export function getDayInstructions(): string {
  return DAY_INSTRUCTIONS;
}

export function buildDayPrompt(
  brief: TripBriefInput,
  skeleton: TripSkeleton,
  day: SkeletonDay
): string {
  // Only this day's city's facts — the other destinations' curated facts
  // are irrelevant to writing this day and would otherwise be re-sent on
  // every parallel day call.
  const { tripBlock, factsBlock, warning } = buildContext(brief, undefined, day.city);

  const accommodation = skeleton.accommodation.find(
    (a) => a.city.toLowerCase().trim() === day.city.toLowerCase().trim()
  );

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
    `Day ${day.day} — ${day.date}`,
    `City: ${day.city}`,
    `Theme: ${day.theme}`,
    `Anchors for THIS day (each becomes an item, names exactly as written): ${
      day.anchors.length ? day.anchors.join("; ") : "(none — build the day from the theme)"
    }`,
  ];

  if (day.transport_note) {
    lines.push(`Transport for this day (include it, follow it exactly): ${day.transport_note}`);
  } else {
    lines.push(`Transport: no arrival/departure leg on this day — do not invent one.`);
  }

  if (day.include_lodging && accommodation) {
    const where = accommodation.name
      ? `${accommodation.name}${accommodation.area ? `, ${accommodation.area}` : ""} — use this exact ` +
        `property name in the title AND in venue_name, do not substitute a generic description`
      : `no specific property was verified for this city, so keep it generic and set venue_name to ` +
        `null — do NOT invent a hotel name`;
    lines.push(
      `Accommodation (include exactly one "lodging" item for this night): ${where}. ` +
        `€${accommodation.cost_per_night_eur} for this one night, ` +
        `source_confidence "${accommodation.source_confidence}", source_urls ` +
        `${JSON.stringify(accommodation.source_urls ?? [])}.`
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
      `Anchors used on OTHER days — never name any of these here: ${otherAnchors.join("; ")}`
    );
  }

  lines.push(
    ``,
    `Trip summary for context (do not repeat it in your output): ${skeleton.trip_summary}`,
    ``,
    `Write day ${day.day} now, as the single JSON day object described in your instructions.`
  );

  return lines.join("\n");
}

function normalizeVenue(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Finds venue names used more than once across the trip. The first use of
 * a name is legitimate and kept; every later one is a genuine duplicate the
 * traveler would notice — the same cafe two mornings running reads as the
 * app being careless.
 *
 * Returns the offending items rather than mutating them, because the right
 * response is to REPLACE the venue (see repairDuplicateVenues in index.ts),
 * not to strip its name. An earlier version simply un-named duplicates,
 * which traded one visible flaw for another: the day kept its breakfast but
 * lost the specific, checkable venue that makes this product worth using. */
export function findDuplicateVenueItems(
  days: ItineraryDay[]
): { item: ItineraryItem; day: ItineraryDay; takenNames: string[] }[] {
  const seen = new Set<string>();
  const allNames: string[] = [];
  const dupes: { item: ItineraryItem; day: ItineraryDay; takenNames: string[] }[] = [];

  for (const day of [...days].sort((a, b) => a.day - b.day)) {
    for (const item of day.items) {
      const name = item.venue_name?.trim();
      if (!name) continue;
      const key = normalizeVenue(name);
      if (!key) continue;
      if (seen.has(key)) dupes.push({ item, day, takenNames: [] });
      else {
        seen.add(key);
        allNames.push(name);
      }
    }
  }
  // Every duplicate needs the full taken list, including names claimed by
  // later days, so a replacement can't collide with something else.
  for (const d of dupes) d.takenNames = allNames;
  return dupes;
}

/** Fallback used only when a replacement couldn't be found — strips the
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

/** Structural sanity check before we commit to a two-phase result. Anything
 * failing here means falling back to the single-call path rather than
 * shipping a half-formed itinerary — the whole point of this being an
 * optimization is that it can't cost correctness. */
export function isUsableSkeleton(skeleton: unknown): skeleton is TripSkeleton {
  if (!skeleton || typeof skeleton !== "object") return false;
  const s = skeleton as Partial<TripSkeleton>;
  if (!s.budget_feasibility || typeof s.trip_summary !== "string") return false;
  if (!Array.isArray(s.days) || s.days.length === 0) return false;
  if (!Array.isArray(s.accommodation)) return false;
  return s.days.every(
    (d) => typeof d?.day === "number" && typeof d?.date === "string" && Array.isArray(d?.anchors)
  );
}
