// The wait screen's stages and the "email me when it's ready" ping,
// through a real processJob with a fake model and a fake Redis.
//
// What is pinned: the stages the job record passes through are in order
// and never go backwards (the page draws ticks from them, so a regression
// would tick a step that has not happened); the ping goes out once, after
// the done record has been written, to the URL in the request; and a failed
// job pings nothing and drops the request.
//
// Run: npm run test:stage-notify

import type Redis from "ioredis";
import Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, tripReadyNotifyKey, type Job } from "./jobs";
import { check, fakeMessages, finish, heading, section } from "./testutil";
import type { TripBriefInput } from "./types";

heading("stages and the ready ping through processJob");

const DATES = ["2027-03-18", "2027-03-19"];
const brief: TripBriefInput = {
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: DATES[0],
  end_date: DATES[1],
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

function kindOf(system: unknown): string {
  const sys = JSON.stringify(system ?? "");
  if (sys.includes("STAGE 1A")) return "frame";
  if (sys.includes("STAGE 1B")) return "plan";
  if (sys.includes("STAGE 2")) return "day";
  if (sys.includes("price per night")) return "lodging-rate";
  if (sys.includes("well-reviewed mid-range hotel")) return "lodging-property";
  if (sys.includes("fixing ONE line")) return "venue-repair";
  if (sys.includes("filling ONE missing meal")) return "meal-repair";
  return "other";
}

function answer(kind: string, n: number): string {
  switch (kind) {
    case "frame":
      return JSON.stringify({
        budget_feasibility: { feasible: true, min_realistic_total_eur: 320, reasoning: "r" },
        trip_summary: "A short trip.",
        key_decisions: [{ decision: "d", reasoning: "r", alternative_considered: "a", confidence: "high" }],
        things_to_skip: [{ item: "i", reasoning: "r" }],
        accommodation: [{ city: "Rome", name: null, area: null, cost_per_night_eur: 50, source_confidence: "inferred", source_urls: [] }],
      });
    case "plan":
      return JSON.stringify({
        days: DATES.map((date, i) => ({
          day: i + 1,
          date,
          city: "Rome",
          theme: "t",
          include_lodging: i < DATES.length - 1,
          anchors: [`Venue ${i + 1} (afternoon)`],
          meals: ["breakfast", "lunch", "dinner"],
          transport_note: i === 0 ? "Flight from Sofia" : null,
        })),
      });
    case "day":
      return JSON.stringify({
        day: 1,
        date: DATES[0],
        items: [{ time: "08:30", type: "meal", title: "Breakfast at Cafe Uno", venue_name: "Cafe Uno", location: "City center", cost_estimate_eur: 12, reasoning: "r", source_confidence: "inferred" }],
        feasibility_flag: null,
      });
    case "lodging-rate":
      return JSON.stringify({ cost_estimate_eur: 55, source_url: "https://example.com/rate" });
    case "lodging-property":
      return JSON.stringify({ name: "Hotel Real", area: "City center" });
    case "venue-repair":
      return JSON.stringify({ title: `Breakfast at Cafe ${n}`, venue_name: `Cafe ${n}`, reasoning: "r" });
    case "meal-repair":
      return JSON.stringify({ time: "13:00", title: `Meal at Place ${n}`, venue_name: `Place ${n}`, location: "City center", cost_estimate_eur: 18, reasoning: "r" });
    default:
      return "{}";
  }
}

function makeClient(failOn: string | null): Anthropic {
  let n = 0;
  return {
    messages: fakeMessages(async (params: { system?: unknown }) => {
      const kind = kindOf(params.system);
      if (kind === failOn) throw new Error("kaboom");
      return { content: [{ type: "text", text: answer(kind, ++n) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
    }),
  } as unknown as Anthropic;
}

/** Records every stage the job record is written with, in order. */
function makeRedis(id: string) {
  const store = new Map<string, string>();
  const stages: string[] = [];
  let doneWrittenAt = -1;
  let writes = 0;
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      if (k === jobKey(id)) {
        writes++;
        const job = JSON.parse(v) as Job;
        const stage = job.progress?.stage;
        if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
        if (job.status === "done" && doneWrittenAt === -1) doneWrittenAt = writes;
      }
      return "OK";
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    expire: async () => 1,
    rpush: async () => 1,
    lpush: async () => 1,
    ltrim: async () => "OK",
    incrbyfloat: async () => "0",
    sadd: async () => 1,
    multi: () => {
      const self: unknown = new Proxy({}, { get: (_t, prop) => (prop === "exec" ? async () => [] : () => self) });
      return self;
    },
  } as unknown as Redis;
  return { redis, store, stages, doneWrittenAt: () => doneWrittenAt };
}

function seed(store: Map<string, string>, id: string): void {
  const job: Job = { id, status: "pending", brief, createdAt: Date.now(), updatedAt: Date.now() };
  store.set(jobKey(id), JSON.stringify(job));
}

const ORDER = ["planning", "writing", "checking", "repairing", "finishing"];

async function main() {
  const realFetch = globalThis.fetch;
  const pings: { url: string; body: string; doneAlready: boolean }[] = [];

  section("a successful job");
  {
    const fake = makeRedis("job-ok");
    seed(fake.store, "job-ok");
    fake.store.set(
      tripReadyNotifyKey("job-ok"),
      JSON.stringify({ email: "me@example.com", url: "https://yourdecide.com/api/trip-email/ready", requestedAt: 1 })
    );
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      if (String(url).includes("/api/trip-email/ready")) {
        pings.push({ url: String(url), body: init?.body ?? "", doneAlready: fake.doneWrittenAt() !== -1 });
        return new Response("{}", { status: 200 });
      }
      return realFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    await processJob(fake.redis, makeClient(null), "job-ok");
    // The ping is fire-and-forget after the final write; give it its turn.
    await new Promise((d) => setTimeout(d, 50));

    const job = JSON.parse(fake.store.get(jobKey("job-ok")) ?? "null") as Job | null;
    check("the job is done", job?.status === "done", `${job?.status} ${job?.error ?? ""}`);
    check("it starts at planning", fake.stages[0] === "planning", fake.stages.join(" > "));
    check(
      "and only ever moves forward",
      fake.stages.every((s, i) => i === 0 || ORDER.indexOf(s) > ORDER.indexOf(fake.stages[i - 1])),
      fake.stages.join(" > ")
    );
    check(
      "through writing, checking and finishing",
      ["writing", "checking", "finishing"].every((s) => fake.stages.includes(s)),
      fake.stages.join(" > ")
    );
    check("the ready ping went once", pings.length === 1, String(pings.length));
    check("to the URL in the request", pings[0]?.url === "https://yourdecide.com/api/trip-email/ready", pings[0]?.url);
    check("carrying the job id", JSON.parse(pings[0]?.body || "{}").jobId === "job-ok", pings[0]?.body);
    check("after the done record was written", pings[0]?.doneAlready === true);
  }

  section("a failed job");
  {
    pings.length = 0;
    const fake = makeRedis("job-fail");
    seed(fake.store, "job-fail");
    fake.store.set(
      tripReadyNotifyKey("job-fail"),
      JSON.stringify({ email: "me@example.com", url: "https://yourdecide.com/api/trip-email/ready", requestedAt: 1 })
    );
    await processJob(fake.redis, makeClient("frame"), "job-fail");
    await new Promise((d) => setTimeout(d, 50));
    const job = JSON.parse(fake.store.get(jobKey("job-fail")) ?? "null") as Job | null;
    check("the job failed", job?.status === "error", job?.status);
    check("no ping", pings.length === 0, String(pings.length));
    check("and the request is dropped", !fake.store.has(tripReadyNotifyKey("job-fail")));
  }

  section("no request, no ping");
  {
    pings.length = 0;
    const fake = makeRedis("job-quiet");
    seed(fake.store, "job-quiet");
    await processJob(fake.redis, makeClient(null), "job-quiet");
    await new Promise((d) => setTimeout(d, 50));
    check("nothing was sent", pings.length === 0, String(pings.length));
  }

  globalThis.fetch = realFetch;
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
