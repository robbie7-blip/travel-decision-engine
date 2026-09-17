// The failure diagnostics, end to end through processJob.
//
// "Unexpected error generating itinerary." is the fallthrough in
// processJob's catch: the thrown value matched none of the six named cases,
// so the sentence says nothing about what happened. The real error went to
// console.error on Railway, which meant the one failure class that cannot
// explain itself was also the only one whose diagnosis needed log access to
// the other deployment. The last failed generation's only artifact was a
// screenshot of that sentence.
//
// So the record is now written to Redis and rendered on /admin/health. This
// suite runs the real processJob against a stub client and a stub Redis
// that implements an actual list, and asserts the three things that make
// the feature worth having:
//
//   1. a failure is recorded, with the error's own class name and message,
//      not the sentence the traveler read;
//   2. a SUCCESSFUL generation records nothing, because a diagnostics list
//      that fills up on healthy runs is one nobody reads;
//   3. a Redis that cannot take the write does not turn one failure into
//      two. That is the sharp one: recordWorkerFailure is awaited inside
//      processJob, so a throw there escapes the catch that had just
//      finished handling the original error - and a job that never gets
//      written back sits at "running" until stallReason times it out four
//      minutes later, for a traveler who is watching a spinner.
//
// WHAT BUILDING IT MEASURED, which is worth more than any one assertion
// here: nothing the stub model does reaches the fallthrough. A day call
// that throws is absorbed, the single-call fallback produces nothing
// usable, and what finally escapes is a ModelOutputError with the
// malformed-output sentence. A null day in a refinement is rejected by
// callModel's own validator. Every awaited Redis write inside the try is
// either fire-and-forget or individually caught. So "Unexpected error
// generating itinerary." is NOT something model output can produce through
// this pipeline - which is exactly the kind of fact that was previously
// unavailable without spending a paid generation to find out.
//
// The credential redaction those records go through is covered separately,
// against five real credential shapes, in
// frontend/lib/workerFailure.test.ts - redactSecrets lives in the jobs.ts
// mirrors, so one suite covers both copies.
//
// Run: npm run test:failure-log

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, readWorkerFailure, WORKER_FAILURES_KEY, type Job, type WorkerFailure } from "./jobs";
import { check, finish, heading, section } from "./testutil";
import { fakeMessages } from "./testutil";
import type { TripBriefInput } from "./types";

heading("failure diagnostics through processJob");

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

function frameJson(): string {
  return JSON.stringify({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 320, reasoning: "r" },
    trip_summary: "A short trip.",
    key_decisions: [{ decision: "d", reasoning: "r", alternative_considered: "a", confidence: "high" }],
    things_to_skip: [{ item: "i", reasoning: "r" }],
    accommodation: [
      {
        city: "Rome",
        name: null,
        area: null,
        cost_per_night_eur: 50,
        source_confidence: "inferred",
        source_urls: [],
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
      include_lodging: i < DATES.length - 1,
      anchors: [`Venue ${i + 1} (afternoon)`],
      meals: ["breakfast", "lunch", "dinner"],
      transport_note: i === 0 ? "Flight from Sofia" : null,
    })),
  });
}

function dayJson(): string {
  return JSON.stringify({
    day: 1,
    date: DATES[0],
    items: [
      {
        time: "08:30",
        type: "meal",
        title: "Breakfast at Cafe Uno",
        venue_name: "Cafe Uno",
        location: "City center",
        cost_estimate_eur: 12,
        reasoning: "r",
        source_confidence: "inferred",
      },
    ],
    feasibility_flag: null,
  });
}

/** Which prompt this is, by the same markers the other harnesses use. */
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

/** A client that answers every stage, optionally throwing on one of them.
 *
 * `throwOn` takes a PLAIN Error rather than an Anthropic.APIError, so what
 * it produces is whatever the pipeline itself decides to do with a stage
 * that failed for a reason it does not recognise - which turned out to be
 * the finding recorded in the header. */
function makeClient(throwOn: string | null, error?: unknown): Anthropic {
  let replacements = 0;
  return {
    messages: fakeMessages(async (params: { system?: unknown }) => {
      const kind = kindOf(params.system);
      if (kind === throwOn) throw error ?? new Error("kaboom inside the day call");
      let text: string;
      switch (kind) {
        case "frame":
          text = frameJson();
          break;
        case "plan":
          text = planJson();
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
    }),
  } as unknown as Anthropic;
}

interface FakeRedis {
  redis: Redis;
  store: Map<string, string>;
  lists: Map<string, string[]>;
}

/** A stub with a REAL list, because the cap is part of the behaviour: the
 * worker's LTRIM is the only thing stopping this key growing without
 * bound, and a stub that accepts every command and remembers nothing
 * cannot tell whether it ran. */
function makeRedis(opts: { lpushThrows?: boolean } = {}): FakeRedis {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    expire: async () => 1,
    rpush: async () => 1,
    lpush: async (k: string, v: string) => {
      if (opts.lpushThrows) throw new Error("READONLY You can't write against a read only replica.");
      const list = lists.get(k) ?? [];
      list.unshift(v);
      lists.set(k, list);
      return list.length;
    },
    ltrim: async (k: string, start: number, stop: number) => {
      const list = lists.get(k);
      if (list) lists.set(k, list.slice(start, stop + 1));
      return "OK";
    },
    incrbyfloat: async () => "0",
    sadd: async () => 1,
    multi: () => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get: (_t, prop) => (prop === "exec" ? async () => [] : () => self),
      });
      return self;
    },
  } as unknown as Redis;
  return { redis, store, lists };
}

function seed(fake: FakeRedis, id: string): void {
  const job: Job = {
    id,
    status: "pending",
    brief,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  fake.store.set(jobKey(id), JSON.stringify(job));
}

function jobFrom(fake: FakeRedis, id: string): Job | null {
  const raw = fake.store.get(jobKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as Job;
}

function failuresFrom(fake: FakeRedis): WorkerFailure[] {
  return (fake.lists.get(WORKER_FAILURES_KEY) ?? [])
    .map(readWorkerFailure)
    .filter((f): f is WorkerFailure => f !== null);
}

async function main() {
  section("a failure names itself");

  {
    const fake = makeRedis();
    seed(fake, "job-fail");
    await processJob(fake.redis, makeClient("day"), "job-fail");

    const job = jobFrom(fake, "job-fail");
    check("the job is marked error", job?.status === "error", job?.status);
    // What the traveler is told. The day call throwing does NOT reach the
    // fallthrough - the pipeline absorbs a failed day, the single-call
    // fallback produces nothing usable either, and what finally escapes is
    // the malformed-output sentence. Asserted as it actually behaves,
    // because the point of the record is the gap between this sentence and
    // the error underneath it.
    check(
      "the traveler gets the malformed-output sentence",
      (job?.error ?? "").includes("malformed twice in a row"),
      job?.error
    );

    const failures = failuresFrom(fake);
    check("one failure was recorded", failures.length === 1, String(failures.length));
    const f = failures[0];
    // "ItineraryShapeError", not "Error". Every custom error here is
    // `class X extends Error {}` and none set `name`, so the field the
    // operator scans first read "Error" for all of them until
    // nameOfThrown existed. Measured on this very case.
    check("with the error's real class name", f?.name === "ModelOutputError", f?.name);
    check(
      "and the message the sentence does not carry",
      (f?.message ?? "").includes("no days array"),
      f?.message
    );
    check("attributed to the job", f?.jobId === "job-fail", f?.jobId);
    check("with the trip's length", f?.days === 2, String(f?.days));
    check("and a stack", (f?.stack.length ?? 0) > 0, String(f?.stack.length));
    // The stages that finished, which is the half a stack trace cannot
    // give: the same throw means different things before and after
    // verification has run.
    check("and which stages it got through", Array.isArray(f?.reached), JSON.stringify(f?.reached));
  }

  section("a refinement whose model dropped a day");

  {
    // `{"days": [null, {...}]}` - an ordinary thing for a model to produce
    // while dropping a day, on the path where it writes the whole
    // itinerary rather than one day at a time.
    //
    // This started out as a suspected hole: normalizeItineraryShape gives
    // every OBJECT day an items array but skips a null entry, and
    // processJob then sorted `day.items` for every day in the array. It is
    // NOT reachable - callModel's own validator rejects a day that is not
    // an object first - and this case is what established that rather than
    // assuming it either way. What it asserts is the record's actual
    // value: the traveler gets "malformed twice in a row", which says
    // nothing about what was malformed, and the failure record names the
    // day.
    const fake = makeRedis();
    const id = "job-nullday";
    const baseItinerary = {
      trip_summary: "s",
      budget_feasibility: { feasible: true, min_realistic_total_eur: 100, reasoning: "r" },
      days: [{ day: 1, date: DATES[0], city: "Rome", items: [], feasibility_flag: null }],
      key_decisions: [],
      things_to_skip: [],
    };
    fake.store.set(
      jobKey(id),
      JSON.stringify({
        id,
        status: "pending",
        brief,
        refinement: { question: "Swap day 2", baseItinerary },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const refined = JSON.stringify({
      trip_summary: "s",
      budget_feasibility: { feasible: true, min_realistic_total_eur: 100, reasoning: "r" },
      // The null comes FIRST, so a loop that throws on it never reaches
      // the real day and the failure cannot be mistaken for a partial
      // success.
      days: [
        null,
        {
          day: 2,
          date: DATES[1],
          city: "Rome",
          items: [
            {
              time: "09:00",
              type: "activity",
              title: "Forum",
              location: "Rome",
              cost_estimate_eur: 16,
              reasoning: "r",
              source_confidence: "inferred",
            },
          ],
          feasibility_flag: null,
        },
      ],
      key_decisions: [],
      things_to_skip: [],
    });

    await processJob(
      fake.redis,
      {
        messages: fakeMessages(async () => ({
          content: [{ type: "text", text: refined }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        })),
      } as unknown as Anthropic,
      id
    );

    const job = jobFrom(fake, id);
    check(
      "the traveler is told the output was malformed",
      (job?.error ?? "").includes("malformed twice in a row"),
      `${job?.status} ${job?.error ?? ""}`
    );
    const f = failuresFrom(fake)[0];
    check(
      "and the record says WHAT was malformed",
      (f?.message ?? "").includes("a day that is not an object"),
      f?.message
    );
    check("naming the layer that rejected it", f?.name === "ModelOutputError", f?.name);
  }

  section("the shape of the response the SDK hands over");

  {
    // `response.content` is declared an array and `.text` a string and
    // `usage` an object, all three asserted over an API payload, and seven
    // places read them. Injecting response shapes into this function found
    // four that landed on the catch-all:
    //
    //   content: "text"                  .filter is not a function
    //   content: [{type:"text",text:42}] text.matchAll is not a function
    //   no usage at all                  reading 'server_tool_use' of undefined
    //
    // The third is the one worth naming: that TypeError came from
    // estimateCostUsd, so the ACCOUNTING threw and the traveler was told
    // "Unexpected error generating itinerary" by the code that adds up the
    // bill. All of these now read as an empty text block or a zero cost,
    // which fails extractJson and produces the NAMED malformed-output
    // error with a retry behind it.
    const shapes: [string, unknown][] = [
      ["no content blocks", { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }],
      [
        "only a thinking block",
        { content: [{ type: "thinking", thinking: "hm" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      ],
      [
        "text that is a number",
        { content: [{ type: "text", text: 42 }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      ],
      ["content that is a string", { content: "text", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }],
      ["content that is null", { content: null, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }],
      ["a null block inside content", { content: [null], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }],
      ["no usage at all", { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }],
      ["usage that is a string", { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: "none" }],
      ["no stop_reason", { content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } }],
    ];

    for (const [label, response] of shapes) {
      const fake = makeRedis();
      const id = `job-shape-${label.replace(/\W+/g, "-")}`;
      seed(fake, id);
      let escaped = "";
      try {
        await processJob(
          fake.redis,
          { messages: fakeMessages(async () => response) } as unknown as Anthropic,
          id
        );
      } catch (e) {
        escaped = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
      }
      const job = jobFrom(fake, id);
      check(`${label}: nothing escapes processJob`, escaped === "", escaped);
      check(
        `${label}: and it is a named failure, not the catch-all`,
        job?.error !== "Unexpected error generating itinerary.",
        `${job?.status}: ${job?.error}`
      );
    }
  }

  section("a successful generation records nothing");

  {
    const fake = makeRedis();
    seed(fake, "job-ok");
    await processJob(fake.redis, makeClient(null), "job-ok");

    const job = jobFrom(fake, "job-ok");
    check("the job is done", job?.status === "done", `${job?.status} ${job?.error ?? ""}`);
    check("with an itinerary on it", (job?.result?.days?.length ?? 0) === 2, String(job?.result?.days?.length));
    check("and the failures list is untouched", failuresFrom(fake).length === 0);
  }

  section("the diagnostics cannot make things worse");

  {
    // A Redis that refuses the write. recordWorkerFailure is awaited
    // inside processJob, AFTER its catch has already run - so a throw here
    // would escape processJob entirely and the job would never be written
    // back at all. The traveler's page would then poll a "running" record
    // that nothing was running, for the four minutes STALE_RUNNING_MS
    // allows, and get a different and wronger message at the end of it.
    const fake = makeRedis({ lpushThrows: true });
    seed(fake, "job-both");
    let threw = "";
    try {
      await processJob(fake.redis, makeClient("day"), "job-both");
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    check("processJob does not throw", threw === "", threw);

    const job = jobFrom(fake, "job-both");
    check("the job is still written back", job !== null);
    check("still marked error", job?.status === "error", job?.status);
    check("with the traveler's sentence intact", (job?.error ?? "").length > 0, job?.error);
    check("and nothing in the list", failuresFrom(fake).length === 0);
  }

  section("the list is capped");

  {
    // Ten failures through the real path, against a stub list that really
    // holds what it is given. WORKER_FAILURES_KEPT is 25, so this asserts
    // the LTRIM ran at all (the list would otherwise be 10 either way) by
    // checking the newest is first - the order the page renders and the
    // order LTRIM 0..N-1 preserves.
    const fake = makeRedis();
    for (let i = 0; i < 10; i++) {
      const id = `job-n${i}`;
      seed(fake, id);
      await processJob(fake.redis, makeClient("day", new Error(`failure number ${i}`)), id);
    }
    const failures = failuresFrom(fake);
    check("all ten are there", failures.length === 10, String(failures.length));
    // The job ids, not the messages: what escapes a failed day call is the
    // pipeline's own malformed-output error, not the one the stub threw, so
    // the message is identical on all ten. The id is what distinguishes
    // them, and it is what the page shows.
    check("newest first", failures[0]?.jobId === "job-n9", failures[0]?.jobId);
    check("oldest last", failures[9]?.jobId === "job-n0", failures[9]?.jobId);
  }

  finish();
}

void main();
