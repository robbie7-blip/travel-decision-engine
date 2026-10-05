// Every stage that WRITES a venue must be told the traveler's constraints.
//
// Found by auditing for the shape of the accommodation bug: a stage that
// produces content without consulting a brief field that arrived intact.
// The brief is never the problem - all 25 fields reach the generation
// prompt. The problem is a later stage that writes something new and was
// never handed them.
//
// Two stages write venues after the day calls:
//
//   missing-meal repair   fills a meal the day plan asked for and the
//                         write-up dropped. It passed dietary constraints
//                         from the start, and not mobility or hard limits.
//
//   duplicate-venue repair swaps a venue used twice for a different one.
//                         It passed NONE of them - and duplicateVenueItems
//                         treats meals and activities alike
//                         (isNamedVenueSlot), so this stage replaces
//                         RESTAURANTS. A traveler who declared an allergy
//                         could have a duplicate restaurant swapped for one
//                         chosen in complete ignorance of it.
//
// That last one is why this suite exists. It is the same failure as the
// hotel: the constraint reached the model that wrote the itinerary and not
// the model that rewrote part of it, and nothing downstream could tell.
//
// Asserting on the PROMPT, not the output. A stub model will happily
// return a vegetarian cafe whether or not it was told to, so checking the
// result proves nothing about whether the constraint was passed. The
// question this suite answers is "was the model told", which is the half
// that was actually broken.
//
// Run: npm run test:repair-constraints

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { check, fakeMessages, finish, section } from "./testutil";
import type { TripBriefInput } from "./types";

const CITY = "Rome";
const ALLERGY = "severe shellfish allergy";
const MOBILITY = "cannot manage stairs";
const HARD_NO = "no venues requiring a reservation weeks ahead";

function brief(): TripBriefInput {
  return {
    destinations: [CITY],
    origin: "Sofia",
    start_date: "2027-03-18",
    end_date: "2027-03-19",
    party_size: 2,
    party_composition: "couple",
    budget_total_eur: 2000,
    pace: "relaxed",
    interests: ["food"],
    must_see: [],
    dietary_constraints: [ALLERGY],
    mobility_constraints: [MOBILITY],
    hard_no: [HARD_NO],
    language: "en",
    needs_lodging: false,
    needs_flight: false,
    accommodation_location: "Hotel Artemide",
  };
}

function frameJson(): string {
  return JSON.stringify({
    trip_summary: "A short Rome trip.",
    budget_feasibility: { feasible: true, min_realistic_total_eur: 600, reasoning: "r", verdict_line: "v" },
    key_decisions: [{ decision: "Stay central", why: "Short trip", tradeoff: "Costs more" }],
    things_to_skip: [{ thing: "Day trip", why: "Too far" }],
    accommodation: [],
  });
}

/** Two days whose plans both ask for lunch, so the meal repair has work,
 * and whose write-ups name the SAME restaurant, so the duplicate repair
 * has work too. Both stages therefore run in one job. */
function planJson(): string {
  return JSON.stringify({
    days: [
      { day: 1, date: "2027-03-18", city: CITY, theme: "Centre", include_lodging: false, anchors: [], meals: ["lunch", "dinner"] },
      { day: 2, date: "2027-03-19", city: CITY, theme: "Vatican", include_lodging: false, anchors: [], meals: ["lunch", "dinner"] },
    ],
  });
}

function dayJson(day: number, date: string): string {
  return JSON.stringify({
    day,
    date,
    items: [
      {
        time: "13:00",
        type: "meal",
        // Deliberately identical across both days: this is what makes the
        // duplicate-venue repair fire on a MEAL.
        title: "Lunch at Trattoria Doppia",
        venue_name: "Trattoria Doppia",
        location: "Centro Storico",
        cost_estimate_eur: 20,
        reasoning: "r",
        source_confidence: "inferred",
      },
      {
        time: "10:00",
        type: "activity",
        title: "Walk the centre",
        venue_name: "Pantheon",
        location: "Centro Storico",
        cost_estimate_eur: 0,
        reasoning: "r",
        source_confidence: "inferred",
      },
    ],
    feasibility_flag: null,
  });
}

interface Seen {
  venueRepairPrompts: string[];
  mealRepairPrompts: string[];
  dietaryScreenPrompts: string[];
}

function makeClient(seen: Seen): Anthropic {
  let dayIndex = 0;
  let repairIndex = 0;
  const dates = ["2027-03-18", "2027-03-19"];
  return {
    messages: fakeMessages(async (params: { system?: unknown; messages?: unknown }) => {
      const sys = JSON.stringify(params.system ?? "");
      const user = JSON.stringify(params.messages ?? "");
      const text = ((): string => {
        if (sys.includes("STAGE 1A")) return frameJson();
        if (sys.includes("STAGE 1B")) return planJson();
        if (sys.includes("STAGE 2")) {
          const i = dayIndex++;
          return dayJson(i + 1, dates[i] ?? dates[dates.length - 1]);
        }
        if (sys.includes("checking a travel itinerary's restaurants")) {
          seen.dietaryScreenPrompts.push(user);
          // Flag the first venue in the list: the trip's duplicate
          // restaurant, which is exactly what a shellfish allergy would
          // trip over at a place called "Trattoria del Mare".
          return JSON.stringify({ unsuitable: [1] });
        }
        if (sys.includes("fixing ONE line")) {
          seen.venueRepairPrompts.push(user);
          // Distinct per call. The repair refuses a replacement whose name
          // is already claimed - correctly, since that would re-create the
          // duplicate - and strips the item instead, so a stub that always
          // answers the same thing tests the strip path rather than the
          // replacement one.
          repairIndex += 1;
          return JSON.stringify({
            title: `Lunch at Altra Trattoria ${repairIndex}`,
            venue_name: `Altra Trattoria ${repairIndex}`,
            reasoning: "r",
          });
        }
        if (sys.includes("filling ONE missing meal")) {
          seen.mealRepairPrompts.push(user);
          return JSON.stringify({
            time: "20:00",
            title: "Dinner at Ristorante Nuovo",
            venue_name: "Ristorante Nuovo",
            location: "Centro Storico",
            cost_estimate_eur: 25,
            reasoning: "r",
          });
        }
        return "{}";
      })();
      return {
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    }),
  } as unknown as Anthropic;
}

function makeRedis(store: Map<string, string>): Redis {
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    setex: async (k: string, _t: number, v: string) => {
      store.set(k, v);
      return "OK";
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    lpush: async () => 1,
    rpush: async () => 1,
    ltrim: async () => "OK",
    expire: async () => 1,
    incr: async () => 1,
    incrby: async () => 1,
    incrbyfloat: async () => "0",
    sadd: async () => 1,
    hincrby: async () => 1,
    hgetall: async () => ({}),
    lrange: async () => [],
    keys: async () => [],
    multi: () => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get: (_t, prop) => (prop === "exec" ? async () => [] : () => self),
      });
      return self;
    },
  } as unknown as Redis;
}

async function main() {
  section("every stage that writes a venue knows the constraints");

  const store = new Map<string, string>();
  const id = "repair-constraints";
  const job: Job = {
    id,
    status: "pending",
    brief: brief(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.set(jobKey(id), JSON.stringify(job));

  const seen: Seen = { venueRepairPrompts: [], mealRepairPrompts: [], dietaryScreenPrompts: [] };
  await processJob(makeRedis(store), makeClient(seen), id);
  const finished: Job = JSON.parse(store.get(jobKey(id))!);
  check("the job completed", finished.status === "done", finished.status);

  // Both stages have to have RUN, or the assertions below are vacuous -
  // the mistake this whole audit exists to stop.
  check(
    "the duplicate-venue repair actually ran",
    seen.venueRepairPrompts.length > 0,
    "no venue repair fired, so nothing below is being tested"
  );
  check(
    "the missing-meal repair actually ran",
    seen.mealRepairPrompts.length > 0,
    "no meal repair fired, so nothing below is being tested"
  );

  for (const [label, prompts] of [
    ["duplicate-venue repair", seen.venueRepairPrompts],
    ["missing-meal repair", seen.mealRepairPrompts],
  ] as [string, string[]][]) {
    check(
      `${label} is told the dietary constraints`,
      prompts.length > 0 && prompts.every((p) => p.includes(ALLERGY)),
      `an allergy declared on the form never reached the ${label}`
    );
    check(
      `${label} is told the mobility constraints`,
      prompts.length > 0 && prompts.every((p) => p.includes(MOBILITY)),
      `a mobility constraint never reached the ${label}`
    );
    check(
      `${label} is told the hard limits`,
      prompts.length > 0 && prompts.every((p) => p.includes(HARD_NO)),
      `a "must not violate" constraint never reached the ${label}`
    );
  }

  section("a venue the traveler cannot eat at is replaced, not just asked about");

  check(
    "the dietary screen ran",
    seen.dietaryScreenPrompts.length === 1,
    `${seen.dietaryScreenPrompts.length} screen call(s)`
  );
  check(
    "the screen is given the stated constraint",
    seen.dietaryScreenPrompts.some((p) => p.includes(ALLERGY)),
    "the screen was called without the allergy"
  );
  check(
    "a flagged venue is sent for replacement with the reason",
    seen.venueRepairPrompts.some((p) => p.includes("could not")),
    "a flagged venue never reached the repair, or reached it without a reason"
  );
  check(
    "and the flagged venue is gone from the trip",
    !JSON.stringify(finished.result ?? {}).includes("Trattoria Doppia"),
    "a venue the screen flagged survived into the itinerary"
  );

  finish();
}

void main();
