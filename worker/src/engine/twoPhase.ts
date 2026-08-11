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
// — is handled in the skeleton rather than left to chance: it assigns each
// day its own anchor venues, and every day call is shown the full
// cross-trip anchor list so it can't reuse another day's venue.

import type {
  BudgetFeasibility,
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
  name: string;
  area: string;
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
- ANCHORS ARE THE COMPLETE LIST OF NAMED VENUES FOR THE WHOLE TRIP. The day-expansion stage is \
forbidden from inventing any named business of its own — it can only use what you assign here. So \
anything that needs a real name must appear in some day's anchors, or it will not exist in the \
finished trip.
- That means EVERY MEAL the day realistically needs is an anchor: breakfast, lunch AND dinner for \
a full day, adjusted only for arrival/departure timing (no lunch anchor on a day the traveler \
lands mid-afternoon, no dinner anchor on a day they fly out at 16:00). Do not quietly skip a \
day's lunch — a full day with no midday meal is a hole in the itinerary, not a stylistic choice.
- Anchors must be real, specific, named businesses: "Mocotó (dinner)", not "a churrascaria \
(dinner)"; "Vodka Tattoo (afternoon)", not "a tattoo studio". Name your single best real candidate \
even when you can't confirm current hours/prices. Genuinely generic activities with no business to \
name (a walk through a neighborhood, a rest at the accommodation, a stroll along the river) need \
no anchor — the expansion stage adds those itself.
- NEVER REPEAT AN ANCHOR ANYWHERE IN THE TRIP: each named venue appears on exactly ONE day, in \
exactly one slot. This is the only place duplicates can be prevented — the day-expansion calls \
cannot see each other, so any venue you list twice ships to the traveler as a visible duplicate \
(the same cafe for breakfast two mornings running, the same restaurant twice). Before you finish, \
re-read your anchors across all days and confirm every name is unique.
- So a normal full day is about 5 to 7 anchors (three meals plus two to four activities). Match \
the activity count to the stated pace — relaxed means fewer activities, packed means more — but \
the meals are not the thing you trim to hit a pace.
- Respect all hard constraints exactly (dietary, mobility, budget ceiling, hard_no). Treat \
must-see/must-do items as near-mandatory — assign each to a specific day. If one is genuinely \
infeasible, say so explicitly in trip_summary and in a key_decisions entry rather than silently \
dropping it.
- If any preferences are in direct tension (a packed pace plus mandatory long rests, a long \
interest list on a short trip), say so explicitly in trip_summary and a key_decisions entry \
instead of silently complying with each in isolation.
- ACCOMMODATION: pick one place per city and give its real per-night cost in EUR. If the context \
below includes an already-verified accommodation price for a city, reuse that exact figure and its \
source_urls, and set source_confidence "grounded". Otherwise give your best hedged estimate and \
set source_confidence "inferred" with no source_urls. If the brief says accommodation is already \
arranged, return an empty accommodation array and set include_lodging false on every day.
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
    {"city": "...", "name": "real, specific place", "area": "neighborhood", "cost_per_night_eur": 0, "source_confidence": "grounded|inferred", "source_urls": []}
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
a sensible order. Keep the venue names exactly as given.
- DO NOT INVENT A NAMED BUSINESS. This is absolute. Every restaurant, cafe, bar, museum, studio, \
shop or other named venue in your output must come from THIS day's anchor list — not from the \
other days' list, and not from your own knowledge of the city. You are writing one day of a trip \
in parallel with the other days and you cannot see what they chose, so a venue you add yourself is \
how the traveler ends up with the same cafe for breakfast two mornings running. If a slot feels \
like it wants a place that isn't in your anchors, leave it unnamed instead.
- You may still add connective tissue the anchors don't cover, as long as it names no business: \
walking between two of them, a stroll through a neighborhood or park, browsing an open-air market, \
downtime back at the accommodation, getting to the airport. Write these as real items with a time \
and a reason, just without a venue_name.
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
    lines.push(
      `Accommodation (include exactly one "lodging" item for this night): ${accommodation.name}, ` +
        `${accommodation.area} — €${accommodation.cost_per_night_eur} for this one night, ` +
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

/** Last line of defence against the one failure mode parallel day calls
 * can't see for themselves: the same named venue landing on two days.
 * The prompts prevent it two ways over (the skeleton must not repeat an
 * anchor; day calls must not invent names at all) — this catches the
 * residue anyway, because "the same cafe two mornings running" is exactly
 * the kind of thing a traveler notices immediately and reads as the app
 * being careless.
 *
 * Later occurrences are stripped of their venue identity rather than
 * dropped outright: deleting the item would leave a hole in the day (no
 * breakfast at all), whereas an unnamed "breakfast near the hotel" is a
 * weaker but still honest item, and downstream venue verification simply
 * skips it. Days are processed in order so the FIRST day to use a venue
 * keeps it. */
function dedupeVenuesAcrossDays(days: ItineraryDay[]): number {
  const seen = new Set<string>();
  let stripped = 0;
  for (const day of days) {
    for (const item of day.items) {
      const name = item.venue_name?.trim();
      if (!name) continue;
      const key = normalizeVenue(name);
      if (!key) continue;
      if (seen.has(key)) {
        item.venue_name = null;
        stripped++;
      } else {
        seen.add(key);
      }
    }
  }
  return stripped;
}

/** Stitches phase 1's trip-level fields together with phase 2's independently
 * generated days. Days are sorted by number rather than trusting the order
 * the parallel calls happened to resolve in. */
export function assembleItinerary(skeleton: TripSkeleton, days: ItineraryDay[]): Itinerary {
  const ordered = [...days].sort((a, b) => a.day - b.day);
  const stripped = dedupeVenuesAcrossDays(ordered);
  if (stripped > 0) {
    console.warn(
      `[twoPhase] ${stripped} duplicate venue name(s) across days — kept the first use, unnamed the rest`
    );
  }
  return {
    budget_feasibility: skeleton.budget_feasibility,
    trip_summary: skeleton.trip_summary,
    key_decisions: skeleton.key_decisions ?? [],
    days: ordered,
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
