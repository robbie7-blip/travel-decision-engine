// Measures the generation pipeline's CONCURRENCY without making a single
// API call.
//
// Every latency regression in this pipeline has been the same kind of bug:
// work that should overlap quietly running one stage after another. Each
// time, it was found by deploying, asking the owner to burn a paid
// generation, and reading the wall-clock number — which is slow, costs real
// money per attempt, and had already been wrong twice before it was right.
//
// None of that is necessary. Whether two stages overlap is a property of
// the code, not of the model: stub the Anthropic client with calls that
// take a known, fixed time and the total tells you the shape of the
// critical path exactly. A serialization bug shows up as total ≈ sum, a
// correctly parallel pipeline as total ≈ max. Real model latency is the one
// thing this can't measure, and it's also the one thing no amount of
// deploying would let us control.
//
// Two scenarios run, and the long one is the point. A 3-day trip passed
// every check here while a 10-day trip took two full minutes, because the
// parallel-day cap was 6: the sixth and seventh days went into different
// waves and nothing in the assertions could see it. Trip length is now a
// dimension the harness actually varies.
//
// Run: npm run test:pipeline

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import type { TripBriefInput } from "./types";

const CALL_MS = 400; // stands in for one model round-trip

function briefFor(destinations: string[], startDate: string, endDate: string): TripBriefInput {
  return {
    destinations,
    origin: "Sofia",
    start_date: startDate,
    end_date: endDate,
    party_size: 2,
    party_composition: "couple",
    budget_total_eur: 3000,
    pace: "relaxed",
    interests: ["food"],
    must_see: [],
    dietary_constraints: [],
    mobility_constraints: [],
    hard_no: [],
    language: "en",
    needs_lodging: true,
    needs_flight: true,
  };
}

function datesBetween(start: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

interface Scenario {
  label: string;
  destinations: string[];
  dates: string[];
  /** Which city each day is in, same length as dates. */
  cityByDay: string[];
}

function frameJson(scenario: Scenario): string {
  return JSON.stringify({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 320, reasoning: "r" },
    trip_summary: "A short trip.",
    key_decisions: [{ decision: "d", reasoning: "r", alternative_considered: "a", confidence: "high" }],
    things_to_skip: [{ item: "i", reasoning: "r" }],
    accommodation: scenario.destinations.map((city) => ({
      city,
      name: null,
      area: null,
      cost_per_night_eur: 50,
      source_confidence: "inferred",
      source_urls: [],
    })),
  });
}

function planJson(scenario: Scenario): string {
  return JSON.stringify({
    days: scenario.dates.map((date, i) => ({
      day: i + 1,
      date,
      city: scenario.cityByDay[i],
      theme: "t",
      include_lodging: i < scenario.dates.length - 1,
      anchors: [`Venue ${i + 1} (afternoon)`],
      meals: ["breakfast", "lunch", "dinner"],
      transport_note: i === 0 ? "Flight from Sofia" : null,
    })),
  });
}

// Deliberately reuses ONE venue name across every day AND leaves out the
// lunch and dinner the plan asked for, so both repair paths are exercised
// rather than skipped.
function dayJson(): string {
  return JSON.stringify({
    day: 1,
    date: "2027-03-18",
    items: [
      {
        time: "08:30",
        type: "meal",
        title: "Breakfast at Shared Cafe",
        venue_name: "Shared Cafe",
        location: "City center",
        cost_estimate_eur: 12,
        reasoning: "r",
        source_confidence: "inferred",
      },
    ],
    feasibility_flag: null,
  });
}

interface CallRecord {
  kind: string;
  start: number;
  end: number;
}

function makeClient(scenario: Scenario, records: CallRecord[]): Anthropic {
  let replacements = 0;
  return {
    messages: {
      create: async (params: { system?: unknown; max_tokens?: number }) => {
        const sys = JSON.stringify(params.system ?? "");
        const kind = sys.includes("STAGE 1A")
          ? "frame"
          : sys.includes("STAGE 1B")
            ? "plan"
            : sys.includes("STAGE 2")
              ? "day"
              : sys.includes("price per night")
                ? "lodging-rate"
                : sys.includes("well-reviewed mid-range hotel")
                  ? "lodging-property"
                  : sys.includes("fixing ONE line")
                    ? "venue-repair"
                    : sys.includes("filling ONE missing meal")
                      ? "meal-repair"
                      : "other";
        const start = Date.now();
        await new Promise((r) => setTimeout(r, CALL_MS));
        records.push({ kind, start, end: Date.now() });

        let text: string;
        switch (kind) {
          case "frame":
            text = frameJson(scenario);
            break;
          case "plan":
            text = planJson(scenario);
            break;
          case "day":
            text = dayJson();
            break;
          case "lodging-rate":
            text = JSON.stringify({ cost_estimate_eur: 55, source_url: "https://example.com/rate" });
            break;
          case "lodging-property":
            text = JSON.stringify({ name: "Hotel Real", area: "City center" });
            break;
          case "venue-repair":
            replacements++;
            text = JSON.stringify({
              title: `Breakfast at Cafe ${replacements}`,
              venue_name: `Cafe ${replacements}`,
              reasoning: "r",
            });
            break;
          case "meal-repair":
            replacements++;
            text = JSON.stringify({
              time: "13:00",
              title: `Meal at Place ${replacements}`,
              venue_name: `Place ${replacements}`,
              location: "City center",
              cost_estimate_eur: 18,
              reasoning: "r",
            });
            break;
          default:
            text = "{}";
        }
        return {
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        };
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
    // Chainable no-op: the quality counters are written through a pipeline,
    // and a stub that can't accept one turns a stats write into a thrown
    // error inside the job.
    multi: () => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get: (_t, prop) => (prop === "exec" ? async () => [] : () => self),
      });
      return self;
    },
  } as unknown as Redis;
}

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function overlaps(a: CallRecord, b: CallRecord): boolean {
  return a.start < b.end && b.start < a.end;
}

async function run(scenario: Scenario) {
  console.log(`\n${"=".repeat(72)}\n${scenario.label}\n${"=".repeat(72)}`);

  const store = new Map<string, string>();
  const records: CallRecord[] = [];
  const id = `t-${scenario.dates.length}`;
  const job: Job = {
    id,
    status: "pending",
    brief: briefFor(scenario.destinations, scenario.dates[0], scenario.dates[scenario.dates.length - 1]),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.set(jobKey(id), JSON.stringify(job));

  const startedAt = Date.now();
  await processJob(makeRedis(store), makeClient(scenario, records), id);
  const totalMs = Date.now() - startedAt;

  const finished: Job = JSON.parse(store.get(jobKey(id))!);
  const by = (k: string) => records.filter((r) => r.kind === k);

  console.log(`\nstub call = ${CALL_MS}ms · ${records.length} model calls · total = ${totalMs}ms\n`);

  console.log("job completed");
  check("status is done", finished.status === "done", finished.status);
  check(
    "no fallback to the single-call path",
    finished.timings?.fellBackToSingleCall !== true,
    finished.timings?.fallbackReason ?? ""
  );
  check(
    `all ${scenario.dates.length} days present`,
    (finished.result?.days.length ?? 0) === scenario.dates.length
  );

  const frame = by("frame")[0];
  const plan = by("plan")[0];
  const rate = by("lodging-rate")[0];
  const property = by("lodging-property")[0];
  const days = by("day");
  const venueRepairs = by("venue-repair");
  const mealRepairs = by("meal-repair");

  console.log("\nstages that must run CONCURRENTLY");
  check("phase 1's two halves overlap (frame ‖ plan)", !!frame && !!plan && overlaps(frame, plan));
  check(
    "lodging rate + property overlap (two dedicated searches, one wall-clock cost)",
    !!rate && !!property && overlaps(rate, property)
  );
  check(
    "lodging lookups overlap phase 1 (prefetch is off the critical path)",
    !!frame && !!rate && overlaps(rate, frame)
  );
  check(
    `all ${days.length} day calls overlap each other — ONE wave, not ${Math.ceil(days.length / 6)}`,
    days.length > 1 && days.every((d) => overlaps(d, days[0])),
    days.length > 1
      ? `first day ends at +${days[0].end - startedAt}ms, last starts at +${
          Math.max(...days.map((d) => d.start)) - startedAt
        }ms`
      : ""
  );
  check(
    "venue repair and meal repair share one stage",
    venueRepairs.length > 0 && mealRepairs.length > 0 && overlaps(venueRepairs[0], mealRepairs[0])
  );

  console.log("\nstages that must run IN ORDER");
  check("days start only after phase 1 finishes", days.every((d) => d.start >= plan.end - 50));
  check(
    "duplicate repair ran (the day stub reuses one venue everywhere)",
    venueRepairs.length === scenario.dates.length - 1,
    `${venueRepairs.length} repairs`
  );
  check(
    "missing-meal repair ran (the day stub writes breakfast only)",
    mealRepairs.length === scenario.dates.length * 2,
    `${mealRepairs.length} meal fills, expected ${scenario.dates.length * 2}`
  );

  console.log("\nwhat the traveler actually gets");
  const resultDays = finished.result?.days ?? [];
  const thin = resultDays.filter((d) => d.items.filter((i) => i.type === "meal").length < 3);
  check("every day has all three meals after repair", thin.length === 0, `${thin.length} day(s) short`);
  const sorted = resultDays.every((d) =>
    d.items.every((it, i) => i === 0 || (d.items[i - 1].time ?? "") <= (it.time ?? ""))
  );
  check("repaired items land in clock order, not appended at the end", sorted);

  // The gate runs last and its verdict is written onto the job. Asserting
  // it here is what makes this an end-to-end quality test rather than only
  // a concurrency one: the stub feeds the pipeline days that are broken in
  // exactly the ways real generations have been (one venue reused
  // everywhere, breakfast only), and the repairs have to actually fix them
  // — not merely run.
  check("the acceptance gate ran and recorded a verdict", finished.quality != null);
  check(
    "no duplicate venue survived the repair",
    !finished.quality?.findings.some((f) => f.check === "no_duplicate_venues"),
    finished.quality?.findings.map((f) => f.detail).join("; ") ?? ""
  );
  check(
    "no missing meal survived the repair",
    !finished.quality?.findings.some((f) => f.check === "meals_present")
  );

  console.log("\ncritical path shape");
  // phase 1 (‖ lodging) -> days (‖) -> repairs (‖)  ==  3 sequential stages
  const serialUpperBound = records.length * CALL_MS;
  const parallelExpectation = 3 * CALL_MS;
  check(
    `total is close to max-path (~${parallelExpectation}ms), not sum (~${serialUpperBound}ms)`,
    totalMs < parallelExpectation * 1.9,
    `${totalMs}ms across ${records.length} model calls`
  );
  check(
    "total does not grow with trip length",
    totalMs < parallelExpectation * 1.9,
    `${totalMs}ms for ${scenario.dates.length} days`
  );
}

async function main() {
  const short = datesBetween("2026-12-28", 3);
  await run({
    label: "SHORT TRIP — 3 days, 1 city (the shape that measured 30s)",
    destinations: ["Chisinau"],
    dates: short,
    cityByDay: short.map(() => "Chisinau"),
  });

  // The trip that took two minutes. Ten days across three cities, which is
  // where a parallel-day cap of 6 turned phase 2 into two waves.
  const long = datesBetween("2027-03-18", 10);
  const cities = ["Ubud", "Seminyak", "Uluwatu"];
  await run({
    label: "LONG TRIP — 10 days, 3 cities (the shape that measured 2 minutes)",
    destinations: cities,
    dates: long,
    cityByDay: long.map((_, i) => cities[Math.min(Math.floor(i / 4), cities.length - 1)]),
  });

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
