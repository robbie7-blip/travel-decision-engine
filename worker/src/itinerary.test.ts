// Runs the REAL pipeline over a realistic fake generation and reads the
// finished trip — no API key, no Redis, no money.
//
// This exists because of a specific unfairness. Every content mistake this
// product has shipped was found the same way: the owner paid for a
// generation, opened it, and spotted something silly. A hotel priced at the
// two-night total on both nights. An Italian dinner inside an English trip.
// "Check in to the hotel" on the second night. A flight landing with no way
// into town. None of those were subtle, and none of them needed a real
// model to catch — they only needed something to look at the output.
//
// pipeline.test.ts measures WHEN things happen. This measures WHAT comes
// out. The stub returns a plausible Rome-shaped trip with the exact flaws
// that have shipped before, the real processJob runs over it, and the
// assertions are about the itinerary a traveler would actually read.
//
// It also captures every prompt the pipeline sends, because a whole class
// of these bugs is not bad judgement but a rule that never made it into the
// request — the instruction exists, and nothing passes it through.
//
// Run: npm run test:itinerary

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryItem, TripBriefInput } from "./types";

const BRIEF: TripBriefInput = {
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2026-11-06",
  end_date: "2026-11-08", // two nights
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 2000,
  pace: "moderate",
  interests: ["food", "architecture"],
  must_see: ["Pantheon"],
  dietary_constraints: ["vegetarian"],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
};

const DATES = ["2026-11-06", "2026-11-07", "2026-11-08"];
const PER_NIGHT = 95;

/** What the lodging lookup found: a real property at a real nightly rate. */
const HOTEL = { name: "Hotel Artemide", area: "Via Nazionale", rate: PER_NIGHT };

function frameJson(): string {
  return JSON.stringify({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 950, reasoning: "r" },
    trip_summary: "A compact three-day Rome getaway.",
    key_decisions: [{ decision: "Fly", reasoning: "No direct train", alternative_considered: "Bus", confidence: "high" }],
    things_to_skip: [{ item: "Borghese Gallery", reasoning: "Needs its own half day" }],
    accommodation: [
      {
        city: "Rome",
        name: HOTEL.name,
        area: HOTEL.area,
        cost_per_night_eur: HOTEL.rate,
        source_confidence: "grounded",
        source_urls: ["https://example.com/rate"],
      },
    ],
  });
}

function planJson(): string {
  return JSON.stringify({
    days: DATES.map((date, i) => ({
      day: i + 1,
      date,
      city: "Rome",
      theme: "t",
      include_lodging: i < 2,
      anchors: i === 2 ? ["Pantheon (morning)"] : [`Sight ${i + 1} (afternoon)`],
      meals: i === 0 ? ["lunch", "dinner"] : ["breakfast", "lunch", "dinner"],
      transport_note: i === 0 ? "Flight from Sofia to Rome" : i === 2 ? "Flight from Rome to Sofia" : null,
    })),
  });
}

/** A day written the way a real generation writes one — several items, real
 * names, sensible times — carrying the flaws that have actually shipped:
 *
 *   - day 1 prices the lodging at the WHOLE STAY (the EUR 264 bug)
 *   - day 2 forgets its dinner entirely (the Bali bug)
 *   - day 2 reuses day 1's lunch venue (the Chisinau bug)
 *   - every day leaks the internal meals_covered self-check field
 */
function dayJson(dayNumber: number): string {
  const date = DATES[dayNumber - 1];
  const lodgingItem = (price: number): ItineraryItem => ({
    time: "22:00",
    type: "lodging",
    title: dayNumber === 1 ? `Check in to ${HOTEL.name}` : `Night at ${HOTEL.name}`,
    venue_name: HOTEL.name,
    location: `${HOTEL.area}, Rome`,
    cost_estimate_eur: price,
    reasoning: "Central base",
    source_confidence: "grounded",
    source_urls: ["https://example.com/rate"],
  });

  const base: Record<string, unknown> = { day: dayNumber, date, feasibility_flag: null };
  base.meals_covered = ["breakfast", "lunch", "dinner"];

  if (dayNumber === 1) {
    base.items = [
      { time: "09:00", type: "transport", title: "Flight from Sofia to Rome", venue_name: null, is_flight: true, location: "Sofia to Rome", cost_estimate_eur: 150, reasoning: "r", source_confidence: "inferred" },
      { time: "12:30", type: "transport", title: "Leonardo Express to Termini", venue_name: null, location: "Fiumicino to Termini, Rome", cost_estimate_eur: 28, reasoning: "r", source_confidence: "inferred" },
      // Two nights' worth on a single night — the bug that shipped.
      lodgingItem(PER_NIGHT * 2),
      { time: "14:00", type: "meal", title: "Lunch at Ai Tre Scalini", venue_name: "Ai Tre Scalini", location: "Monti, Rome", cost_estimate_eur: 30, reasoning: "r", source_confidence: "inferred" },
      { time: "16:00", type: "activity", title: "Sight 1", venue_name: "Colosseum", location: "Colosseo, Rome", cost_estimate_eur: 36, reasoning: "r", source_confidence: "inferred" },
      { time: "20:00", type: "meal", title: "Dinner at Pianostrada", venue_name: "Pianostrada", location: "Trastevere, Rome", cost_estimate_eur: 60, reasoning: "r", source_confidence: "inferred" },
    ];
  } else if (dayNumber === 2) {
    base.items = [
      { time: "08:00", type: "meal", title: "Breakfast at Faro Roma", venue_name: "Faro Roma", location: "Prati, Rome", cost_estimate_eur: 12, reasoning: "r", source_confidence: "inferred" },
      { time: "10:00", type: "activity", title: "Vatican Museums", venue_name: "Vatican Museums", location: "Vatican City", cost_estimate_eur: 50, reasoning: "r", source_confidence: "inferred" },
      // Day 1's lunch venue again.
      { time: "13:00", type: "meal", title: "Lunch at Ai Tre Scalini", venue_name: "Ai Tre Scalini", location: "Monti, Rome", cost_estimate_eur: 30, reasoning: "r", source_confidence: "inferred" },
      { time: "16:00", type: "activity", title: "Castel Sant'Angelo", venue_name: "Castel Sant'Angelo", location: "Borgo, Rome", cost_estimate_eur: 15, reasoning: "r", source_confidence: "inferred" },
      // ...no dinner at all, AND no bed — so checkBudgetIntegrity has to
      // clone one in, which is where two separate bugs used to live.
    ];
  } else {
    base.items = [
      { time: "08:00", type: "meal", title: "Breakfast at Caffe Sant'Anselmo", venue_name: "Caffe Sant'Anselmo", location: "Aventino, Rome", cost_estimate_eur: 8, reasoning: "r", source_confidence: "inferred" },
      { time: "09:00", type: "activity", title: "Pantheon", venue_name: "Pantheon", location: "Piazza della Rotonda, Rome", cost_estimate_eur: 10, reasoning: "r", source_confidence: "inferred" },
      { time: "12:00", type: "meal", title: "Lunch at Roscioli", venue_name: "Roscioli", location: "Campo de' Fiori, Rome", cost_estimate_eur: 40, reasoning: "r", source_confidence: "inferred" },
      { time: "13:30", type: "activity", title: "Piazza Navona", venue_name: "Piazza Navona", location: "Centro Storico, Rome", cost_estimate_eur: 0, reasoning: "r", source_confidence: "inferred" },
      { time: "15:00", type: "transport", title: "Leonardo Express to Fiumicino", venue_name: null, location: "Termini to Fiumicino, Rome", cost_estimate_eur: 28, reasoning: "r", source_confidence: "inferred" },
      { time: "17:00", type: "transport", title: "Flight from Rome to Sofia", venue_name: null, is_flight: true, location: "Rome to Sofia", cost_estimate_eur: 150, reasoning: "r", source_confidence: "inferred" },
    ];
  }
  return JSON.stringify(base);
}

interface Sent {
  kind: string;
  system: string;
  user: string;
}

function classify(system: string): string {
  if (system.includes("STAGE 1A")) return "frame";
  if (system.includes("STAGE 1B")) return "plan";
  if (system.includes("STAGE 2")) return "day";
  if (system.includes("price per night")) return "lodging-rate";
  if (system.includes("well-reviewed mid-range hotel")) return "lodging-property";
  if (system.includes("fixing ONE line")) return "venue-repair";
  if (system.includes("filling ONE missing meal")) return "meal-repair";
  return "other";
}

function makeClient(sent: Sent[]): Anthropic {
  let dayCursor = 0;
  let replacements = 0;
  return {
    messages: {
      create: async (params: { system?: unknown; messages?: { content?: unknown }[] }) => {
        const system = JSON.stringify(params.system ?? "");
        const user = String(params.messages?.[0]?.content ?? "");
        const kind = classify(system);
        sent.push({ kind, system, user });

        let text: string;
        switch (kind) {
          case "frame":
            text = frameJson();
            break;
          case "plan":
            text = planJson();
            break;
          case "day": {
            // The prompt states which day it wants; honour it so each day's
            // planted flaw lands where the assertions expect.
            const m = /Day (\d+) —/.exec(user);
            const n = m ? Number(m[1]) : ++dayCursor;
            text = dayJson(n);
            break;
          }
          case "lodging-rate":
            text = JSON.stringify({ cost_estimate_eur: HOTEL.rate, source_url: "https://example.com/rate" });
            break;
          case "lodging-property":
            text = JSON.stringify({ name: HOTEL.name, area: HOTEL.area });
            break;
          case "venue-repair":
            replacements++;
            text = JSON.stringify({ title: `Lunch at Trattoria ${replacements}`, venue_name: `Trattoria ${replacements}`, reasoning: "r" });
            break;
          case "meal-repair":
            replacements++;
            text = JSON.stringify({
              time: "20:00",
              title: `Dinner at Osteria ${replacements}`,
              venue_name: `Osteria ${replacements}`,
              location: "Trastevere, Rome",
              cost_estimate_eur: 45,
              reasoning: "r",
            });
            break;
          default:
            text = "{}";
        }
        return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      },
    },
  } as unknown as Anthropic;
}

function makeRedis(store: Map<string, string>): Redis {
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    expire: async () => 1,
    rpush: async () => 1,
    ltrim: async () => "OK",
    incrbyfloat: async () => "0",
    sadd: async () => 1,
    multi: () => {
      const self: unknown = new Proxy({}, { get: (_t, p) => (p === "exec" ? async () => [] : () => self) });
      return self;
    },
  } as unknown as Redis;
}

async function main() {
  heading("FINISHED ITINERARY — what a traveler would actually read");

  const store = new Map<string, string>();
  const sent: Sent[] = [];
  const job: Job = { id: "r1", status: "pending", brief: BRIEF, createdAt: Date.now(), updatedAt: Date.now() };
  store.set(jobKey("r1"), JSON.stringify(job));

  await processJob(makeRedis(store), makeClient(sent), "r1");
  const finished: Job = JSON.parse(store.get(jobKey("r1"))!);
  const result = finished.result as Itinerary;
  const items = (result?.days ?? []).flatMap((d) => d.items);
  const dayPrompts = sent.filter((s) => s.kind === "day");

  section("the job completed at all");
  check("status is done", finished.status === "done", finished.status);
  check("three days", (result?.days ?? []).length === 3);
  check("did not fall back to the single-call path", finished.timings?.fellBackToSingleCall !== true);

  section("accommodation — the EUR 264 bug");
  const lodging = items.filter((i) => i.type === "lodging");
  check("one lodging item per night", lodging.length === 2, `${lodging.length}`);
  check(
    "the whole-stay price was corrected back to one night",
    lodging.every((i) => i.cost_estimate_eur === PER_NIGHT),
    lodging.map((i) => i.cost_estimate_eur).join(", ")
  );
  check("the property is named on every night", lodging.every((i) => i.venue_name === HOTEL.name));
  check(
    "only the first night reads as a check-in",
    lodging.filter((i) => /check.?in/i.test(i.title)).length === 1,
    lodging.map((i) => i.title).join(" | ")
  );

  section("a cloned accommodation night lands correctly");
  // Day 2's stub omits its bed entirely. checkBudgetIntegrity clones one so
  // the trip total stays honest — but it used to clone the NEAREST lodging
  // item, which is day 1's check-in, and it pushed it on AFTER the day had
  // been sorted. The result was "Check in to Hotel Artemide" sitting at the
  // bottom of day 2, below dinner, on a night they were already staying.
  const dayTwo = result.days.find((d) => d.day === 2)!;
  const clonedBed = dayTwo.items.find((i) => i.type === "lodging");
  check("day 2 got its bed back", clonedBed != null);
  check("and it does not tell them to check in again", !/check.?in/i.test(clonedBed?.title ?? ""), clonedBed?.title);
  check(
    "and it is placed by its time, not appended after dinner",
    (() => {
      const times = dayTwo.items.map((i) => i.time ?? "");
      return times.every((t, i) => i === 0 || times[i - 1] <= t);
    })(),
    dayTwo.items.map((i) => `${i.time} ${i.type}`).join(" | ")
  );

  section("meals — the Bali bug");
  for (const day of result.days) {
    const meals = day.items.filter((i) => i.type === "meal").length;
    const owed = day.day === 1 ? 2 : 3; // day 1 lands at midday, so no breakfast
    check(`day ${day.day} has all ${owed} meals it owes`, meals >= owed, `${meals}`);
  }

  section("duplicate venues — the Chisinau bug");
  const names = items.map((i) => i.venue_name).filter((n): n is string => !!n && n !== HOTEL.name);
  check("no venue appears twice", new Set(names).size === names.length, names.join(", "));

  section("the internal self-check field never reaches the traveler");
  check(
    "meals_covered is stripped from every day",
    (result.days ?? []).every((d) => !("meals_covered" in (d as unknown as Record<string, unknown>)))
  );

  section("items are in clock order, including repaired ones");
  for (const day of result.days) {
    const times = day.items.map((i) => i.time ?? "");
    check(`day ${day.day} reads top to bottom`, times.every((t, i) => i === 0 || times[i - 1] <= t), times.join(" "));
  }

  section("rules that must reach the model, not just exist in the source");
  check("a day prompt lists the meals that day owes", dayPrompts.every((p) => /Meals this day MUST include/.test(p.user)));
  check(
    "the arrival day is told to write the onward leg from the airport",
    dayPrompts.some((p) => /GETTING FROM AND TO THE AIRPORT/.test(p.system))
  );
  check(
    "the first night is marked as the check-in and later nights are not",
    dayPrompts.some((p) => /FIRST night/.test(p.user)) && dayPrompts.some((p) => /NOT the first night/.test(p.user))
  );
  check("day prompts carry the whole-day accounting rule", dayPrompts.every((p) => /ACCOUNT FOR THE WHOLE DAY/.test(p.system)));
  const repairs = sent.filter((s) => s.kind === "meal-repair" || s.kind === "venue-repair");
  check(
    "every repair call names the trip's language outright — the Italian-dinner bug",
    repairs.length > 0 && repairs.every((p) => /Language: write .*English/.test(p.user)),
    repairs.map((p) => (/Language:.*/.exec(p.user) ?? [""])[0]).join(" | ")
  );

  section("the gate's verdict on all of it");
  const q = finished.quality;
  check("a quality report was recorded", q != null);
  const defects = (q?.findings ?? []).filter((f) => f.severity === "defect");
  check(
    "every planted defect was repaired — none survive to the traveler",
    defects.length === 0,
    defects.map((f) => f.detail).join("; ")
  );
  check("the must-see the traveler asked for is present", !defects.some((f) => f.check === "must_see_covered"));

  finish();
}

main();
