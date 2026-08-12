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
// Run: WORKER_NO_AUTOSTART=1 npx tsx src/pipeline.test.ts

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import type { TripBriefInput } from "./types";

const CALL_MS = 400; // stands in for one model round-trip

const brief: TripBriefInput = {
  destinations: ["Chisinau"],
  origin: "Sofia",
  start_date: "2026-12-28",
  end_date: "2026-12-30",
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 1200,
  pace: "moderate",
  interests: ["food"],
  must_see: [],
  dietary_constraints: [],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
};

const DAYS = ["2026-12-28", "2026-12-29", "2026-12-30"];

function skeletonJson(): string {
  return JSON.stringify({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 320, reasoning: "r" },
    trip_summary: "A short trip.",
    key_decisions: [{ decision: "d", reasoning: "r", alternative_considered: "a", confidence: "high" }],
    things_to_skip: [{ item: "i", reasoning: "r" }],
    accommodation: [
      { city: "Chisinau", name: null, area: null, cost_per_night_eur: 50, source_confidence: "inferred", source_urls: [] },
    ],
    days: DAYS.map((date, i) => ({
      day: i + 1,
      date,
      city: "Chisinau",
      theme: "t",
      include_lodging: i < DAYS.length - 1,
      anchors: [`Venue ${i + 1} (dinner)`],
      transport_note: i === 0 ? "Flight from Sofia to Chisinau" : null,
    })),
  });
}

function dayJson(): string {
  // Deliberately reuses ONE venue name across every day, so the duplicate
  // repair path is exercised rather than skipped.
  return JSON.stringify({
    day: 1,
    date: "2026-12-28",
    items: [
      {
        time: "morning",
        type: "meal",
        title: "Breakfast at Shared Cafe",
        venue_name: "Shared Cafe",
        location: "City center, Chisinau",
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

function makeClient(records: CallRecord[]): Anthropic {
  return {
    messages: {
      create: async (params: { system?: unknown; max_tokens?: number }) => {
        const sys = JSON.stringify(params.system ?? "");
        const kind = sys.includes("STAGE 1")
          ? "skeleton"
          : sys.includes("STAGE 2")
            ? "day"
            : sys.includes("price per night")
              ? "lodging-rate"
              : sys.includes("well-reviewed mid-range hotel")
                ? "lodging-property"
                : sys.includes("fixing ONE line")
                  ? "repair"
                  : "other";
        const start = Date.now();
        await new Promise((r) => setTimeout(r, CALL_MS));
        records.push({ kind, start, end: Date.now() });
        const text =
          kind === "skeleton"
            ? skeletonJson()
            : kind === "day"
              ? dayJson()
              : kind === "lodging-rate"
                ? JSON.stringify({ cost_estimate_eur: 55, source_url: "https://example.com/rate" })
                : kind === "lodging-property"
                  ? JSON.stringify({ name: "Hotel Real", area: "City center" })
                  : kind === "repair"
                    ? JSON.stringify({ title: "Breakfast at Other Cafe", venue_name: "Other Cafe", reasoning: "r" })
                    : "{}";
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

async function main() {
  const store = new Map<string, string>();
  const records: CallRecord[] = [];
  const job: Job = {
    id: "t1",
    status: "pending",
    brief,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.set(jobKey("t1"), JSON.stringify(job));

  const startedAt = Date.now();
  await processJob(makeRedis(store), makeClient(records), "t1");
  const totalMs = Date.now() - startedAt;

  const finished: Job = JSON.parse(store.get(jobKey("t1"))!);
  const by = (k: string) => records.filter((r) => r.kind === k);

  console.log(`\nstub call = ${CALL_MS}ms · total = ${totalMs}ms`);
  console.log(`calls: ${records.map((r) => r.kind).join(", ")}\n`);

  console.log("job completed");
  check("status is done", finished.status === "done", finished.status);
  check("no fallback to the single-call path", finished.timings?.fellBackToSingleCall !== true, finished.timings?.fallbackReason ?? "");
  check(`all ${DAYS.length} days present`, (finished.result?.days.length ?? 0) === DAYS.length);

  console.log("\nstages that must run CONCURRENTLY");
  const rate = by("lodging-rate")[0];
  const property = by("lodging-property")[0];
  const skeleton = by("skeleton")[0];
  const days = by("day");

  check("lodging rate + property overlap (two dedicated searches, one wall-clock cost)",
    !!rate && !!property && overlaps(rate, property));
  check("lodging lookups overlap the skeleton (prefetch is off the critical path)",
    !!skeleton && !!rate && overlaps(rate, skeleton),
    skeleton && rate ? `skeleton ${skeleton.start - startedAt}-${skeleton.end - startedAt}, rate ${rate.start - startedAt}-${rate.end - startedAt}` : "");
  check(`all ${days.length} day calls overlap each other (phase 2 is parallel)`,
    days.length > 1 && days.every((d) => overlaps(d, days[0])));

  console.log("\nstages that must run IN ORDER");
  check("days start only after the skeleton finishes",
    days.every((d) => d.start >= skeleton.end - 50));
  check("duplicate repair ran (the day stub reuses one venue everywhere)",
    by("repair").length === DAYS.length - 1, `${by("repair").length} repairs`);

  console.log("\ncritical path shape");
  // skeleton (‖ lodging) -> days (‖) -> repairs (‖)  ==  3 sequential stages
  const serialUpperBound = records.length * CALL_MS;
  const parallelExpectation = 3 * CALL_MS;
  check(`total is close to max-path (~${parallelExpectation}ms), not sum (~${serialUpperBound}ms)`,
    totalMs < parallelExpectation * 1.9,
    `${totalMs}ms across ${records.length} model calls`);
  check("total is well under the serial worst case", totalMs < serialUpperBound * 0.75,
    `${totalMs}ms vs ${serialUpperBound}ms serial`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
