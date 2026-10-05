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
const TRANSPORT: NonNullable<TripBriefInput["transport_preference"]> = "taxi_rideshare";

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
    transport_preference: TRANSPORT,
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
        time: "07:00",
        type: "transport",
        title: "Overnight bus from the airport",
        location: "Fiumicino",
        cost_estimate_eur: 8,
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
  dayPrompts: string[];
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
          seen.dayPrompts.push(user);
          const i = dayIndex++;
          return dayJson(i + 1, dates[i] ?? dates[dates.length - 1]);
        }
        if (sys.includes("things the traveler told us")) {
          seen.dietaryScreenPrompts.push(user);
          // Found by reading the numbered list rather than assuming its
          // order: items are sorted by time before this stage runs, so
          // hardcoded indices silently point at the wrong rows - which is
          // how the first version of this test "passed" while flagging a
          // transport leg for a shellfish allergy.
          const numberOf = (needle: string): number => {
            // `user` is JSON.stringify of the messages, so its newlines are
            // the two characters backslash-n, not real line breaks.
            const line = user.split("\\n").find((l) => l.includes(needle)) ?? "";
            return Number(line.trim().match(/(\d+)\./)?.[1] ?? 0);
          };
          const meal = numberOf("Trattoria Doppia");
          const bus = numberOf("Overnight bus");
          return JSON.stringify({
            violations: [
              // One the venue repair can fix, one it cannot.
              { item: meal, constraint: ALLERGY },
              { item: bus, constraint: HARD_NO },
            ],
          });
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

  const seen: Seen = {
    venueRepairPrompts: [],
    mealRepairPrompts: [],
    dietaryScreenPrompts: [],
    dayPrompts: [],
  };
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

  section("the stage that decides how full a day is knows the pace");

  // Pace is the one brief field that was never MISSING from a prompt - it
  // rides along in the trip block every stage receives. It just had no
  // meaning: "Pace: relaxed" next to one hard number, "a full day needs at
  // least two real things in it", which is the same floor for a packed
  // trip. The field could not change the output, which is the same as not
  // collecting it.
  //
  // Asserted on the prompt for the same reason as everything above: a stub
  // model returns whatever it returns, so only the prompt can answer
  // "was the day call actually told".
  check(
    "the day calls ran",
    seen.dayPrompts.length === 2,
    `${seen.dayPrompts.length} day call(s)`
  );
  check(
    "each day call is told what the stated pace means as a number",
    seen.dayPrompts.every((p) => p.includes("RELAXED") && p.includes("2-3 real things to do")),
    "a day was written without being told what the traveler's pace means"
  );
  // This brief's two days are the arrival and the departure, so both are
  // exempt - and the prompt says so rather than setting a full-day target
  // a departure morning cannot meet.
  check(
    "and a travel day is told it legitimately holds less",
    seen.dayPrompts.every((p) => p.includes("carries the journey")),
    "an arrival/departure day was held to the full-day pace target"
  );

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
    seen.venueRepairPrompts.some((p) => p.includes(ALLERGY)),
    "a flagged venue never reached the repair, or reached it without the constraint it breaks"
  );
  check(
    "and the flagged venue is gone from the trip",
    !JSON.stringify(finished.result ?? {}).includes("Trattoria Doppia"),
    "a venue the screen flagged survived into the itinerary"
  );

  section("how they want to get around is a stated constraint too");

  // The form offers a way to get around and the generation prompt passed
  // it on; nothing read it back. A traveler who picks taxis - often for
  // safety, sometimes because walking is the problem - and is routed
  // through the metro has been ignored exactly as plainly as one sent to a
  // steakhouse with a stated allergy.
  //
  // Folded into the screen that was already running rather than given a
  // call of its own: it costs no extra model call and no generation time.
  check(
    "the screen is told how they want to get around",
    seen.dietaryScreenPrompts.some((p) => p.includes("by taxi or rideshare")),
    "a stated transport preference never reached the screen"
  );

  // The early return is the real risk here. `stated.length === 0` skips
  // the screen entirely, so a traveler whose ONLY stated constraint is how
  // they get around would have been screened for nothing at all - the
  // field would reach the prompt, as it always did, and still be the one
  // thing no one checked.
  {
    const store2 = new Map<string, string>();
    const id2 = "transport-only";
    store2.set(
      jobKey(id2),
      JSON.stringify({
        id: id2,
        status: "pending",
        brief: {
          ...brief(),
          dietary_constraints: [],
          mobility_constraints: [],
          hard_no: [],
          transport_preference: "walking",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies Job)
    );
    const seen2: Seen = {
      venueRepairPrompts: [],
      mealRepairPrompts: [],
      dietaryScreenPrompts: [],
      dayPrompts: [],
    };
    await processJob(makeRedis(store2), makeClient(seen2), id2);
    check(
      "a transport preference alone is enough to run the screen",
      seen2.dietaryScreenPrompts.length === 1,
      `${seen2.dietaryScreenPrompts.length} screen call(s) for a brief whose only constraint is transport`
    );
    check(
      "and it is the constraint the screen is given",
      seen2.dietaryScreenPrompts.some((p) => p.includes("on foot")),
      seen2.dietaryScreenPrompts[0] ?? "(no screen call)"
    );
  }

  section("a violation a venue swap cannot fix is surfaced, not swallowed");

  const stated = (finished.quality?.findings ?? []).filter((f) => f.check === "stated_constraints");
  check(
    "it becomes a finding on the trip's own quality report",
    stated.length === 1,
    `${stated.length} stated_constraints finding(s)`
  );
  check(
    "recorded as a defect, so the gate does not report a pass",
    stated[0]?.severity === "defect" && finished.quality?.passed === false,
    `severity ${stated[0]?.severity}, passed ${finished.quality?.passed}`
  );
  check(
    "and it names the constraint it breaks",
    (stated[0]?.detail ?? "").includes(HARD_NO),
    stated[0]?.detail ?? "(no detail)"
  );

  finish();
}

void main();
