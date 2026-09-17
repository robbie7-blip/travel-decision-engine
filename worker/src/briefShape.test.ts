// The brief the worker takes off the queue, and the write that has to land.
//
// Both of these were found the same way: by injecting faults into the real
// processJob and reading what came out. Neither was hypothetical.
//
// THE BRIEF. readJobRecord checks that `brief` is an object and stops,
// because parseTripBrief owns the contents - on the other deployment,
// before enqueue. This process takes whatever is on the queue. Five shapes
// broke it, every one of them a single wrong type on a list field:
//
//   {}                              TypeError: destinations is not iterable
//   destinations: "Rome"            job.brief.destinations.join is not a function
//   destinations: [null, "Rome"]    Cannot read properties of null ('split')
//   interests: "food"               brief.interests.join is not a function
//   must_see: null                  Cannot read properties of null ('length')
//
// The first three threw BEFORE processJob's try, so nothing marked the job
// failed at all - the record sat at "running" until stallReason timed it
// out and told the traveler the server had restarted, which had not
// happened. The last two threw INSIDE it and landed on "Unexpected error
// generating itinerary.", the sentence that explains nothing, after work
// that may already have been paid for.
//
// A sixth was worse than a crash: `start_date: "soon"` generated a
// complete trip. briefSpanDays returns null for an unparseable pair so the
// day cap never fired, the model was handed "soon" as a date, and what
// came back was a full, paid itinerary with nonsense on every day - which
// looks finished.
//
// THE FINAL WRITE. The comment above the progress writes already said "the
// final writeJob is the one that has to land" and nothing made it. A Redis
// `set` failure threw after the catch, so it escaped processJob into
// runConsumer's catch-and-continue: a generated and fully paid itinerary
// dropped, with the record left at "running".
//
// Run: npm run test:brief-shape

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { checkBrief } from "./briefShape";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { check, fakeMessages, finish, heading, section } from "./testutil";
import type { TripBriefInput } from "./types";

heading("the queued brief, and the write that has to land");

const DATES = ["2027-03-18", "2027-03-19"];

const good: TripBriefInput = {
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

/** The brief as it comes back from the gate, or null if it was refused. */
function normalized(over: Record<string, unknown>): TripBriefInput | null {
  const out = checkBrief({ ...good, ...over });
  return out.ok ? out.brief : null;
}

function refusedBecause(value: unknown): string | null {
  const out = checkBrief(value);
  return out.ok ? null : out.problem.reason;
}

// --- the end-to-end half ------------------------------------------------

function frameJson(): string {
  return JSON.stringify({
    budget_feasibility: { feasible: true, min_realistic_total_eur: 320, reasoning: "r" },
    trip_summary: "A short trip.",
    key_decisions: [{ decision: "d", reasoning: "r", alternative_considered: "a", confidence: "high" }],
    things_to_skip: [{ item: "i", reasoning: "r" }],
    accommodation: [
      { city: "Rome", name: null, area: null, cost_per_night_eur: 50, source_confidence: "inferred", source_urls: [] },
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

function client(): Anthropic {
  let n = 0;
  return {
    messages: fakeMessages(async (params: { system?: unknown }) => {
      const sys = JSON.stringify(params.system ?? "");
      let text = "{}";
      if (sys.includes("STAGE 1A")) text = frameJson();
      else if (sys.includes("STAGE 1B")) text = planJson();
      else if (sys.includes("STAGE 2")) text = dayJson();
      else if (sys.includes("price per night")) text = JSON.stringify({ cost_estimate_eur: 55, source_url: "https://e.com/r" });
      else if (sys.includes("well-reviewed mid-range hotel")) text = JSON.stringify({ name: "Hotel Real", area: "Centro" });
      else if (sys.includes("fixing ONE line")) {
        n++;
        text = JSON.stringify({ title: `Breakfast at Cafe ${n}`, venue_name: `Cafe ${n}`, reasoning: "r" });
      } else if (sys.includes("filling ONE missing meal")) {
        n++;
        text = JSON.stringify({
          time: "13:00",
          title: `Meal at Place ${n}`,
          venue_name: `Place ${n}`,
          location: "Centro",
          cost_estimate_eur: 18,
          reasoning: "r",
        });
      }
      return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
    }),
  } as unknown as Anthropic;
}

function makeRedis(opts: { setFailsAfter?: number } = {}) {
  const store = new Map<string, string>();
  let sets = 0;
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      sets++;
      if (opts.setFailsAfter !== undefined && sets > opts.setFailsAfter) {
        throw new Error("injected redis set failure");
      }
      store.set(k, v);
      return "OK";
    },
    expire: async () => 1,
    rpush: async () => 1,
    lpush: async () => 1,
    ltrim: async () => "OK",
    incrbyfloat: async () => "0",
    sadd: async () => 1,
    multi: () => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, { get: (_t, p) => (p === "exec" ? async () => [] : () => self) });
      return self;
    },
  } as unknown as Redis;
  return { redis, store, setCount: () => sets };
}

let ids = 0;

/** Runs the real processJob over a brief and reports what the traveler ends
 * up with, plus whether anything escaped. */
async function through(
  briefValue: unknown,
  opts: { setFailsAfter?: number } = {}
): Promise<{ status: string; error: string; escaped: string; brief: unknown }> {
  const id = `brief-${++ids}`;
  const fake = makeRedis(opts);
  fake.store.set(
    jobKey(id),
    JSON.stringify({ id, status: "pending", brief: briefValue, createdAt: Date.now(), updatedAt: Date.now() })
  );
  let escaped = "";
  try {
    await processJob(fake.redis, client(), id);
  } catch (e) {
    escaped = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  }
  const raw = fake.store.get(jobKey(id));
  const job = raw ? (JSON.parse(raw) as Job) : null;
  return { status: job?.status ?? "(no record)", error: job?.error ?? "", escaped, brief: job?.brief };
}

async function main() {
  section("a good brief passes through unchanged");

  {
    const out = checkBrief(good);
    check("it is accepted", out.ok);
    check("with nothing repaired", out.ok && out.repaired.length === 0, out.ok ? out.repaired.join(", ") : "");
    // Field by field, not by stringifying both: the gate rebuilds the
    // object by naming every field, so the KEY ORDER differs and a string
    // comparison would fail on a brief that is identical.
    const sorted = (o: unknown) =>
      JSON.stringify(Object.fromEntries(Object.entries(o as object).sort(([a], [c]) => a.localeCompare(c))));
    check(
      "and every field intact",
      out.ok && sorted(out.brief) === sorted(good),
      out.ok ? sorted(out.brief) : ""
    );
  }

  section("the five shapes that crashed processJob");

  {
    check("an empty object is refused", refusedBecause({}) !== null, String(refusedBecause({})));
    check(
      "destinations as a string is refused",
      refusedBecause({ ...good, destinations: "Rome" }) !== null
    );
    check("destinations empty is refused", refusedBecause({ ...good, destinations: [] }) !== null);

    // This one is REPAIRED rather than refused: a null among real cities is
    // a dropped entry, and "Rome" is still a trip.
    const nulls = normalized({ destinations: [null, "Rome", 7, "  Milan  "] });
    check(
      "a null inside destinations is dropped, not fatal",
      JSON.stringify(nulls?.destinations) === JSON.stringify(["Rome", "Milan"]),
      JSON.stringify(nulls?.destinations)
    );

    check(
      "interests as a string becomes an empty list",
      JSON.stringify(normalized({ interests: "food" })?.interests) === "[]"
    );
    check("must_see null becomes an empty list", JSON.stringify(normalized({ must_see: null })?.must_see) === "[]");
    for (const field of ["dietary_constraints", "mobility_constraints", "hard_no"]) {
      const out = normalized({ [field]: "nope" }) as unknown as Record<string, unknown>;
      check(`${field} too`, JSON.stringify(out?.[field]) === "[]", JSON.stringify(out?.[field]));
    }

    // visited_countries is the optional one: a bad value is dropped, and
    // ABSENCE STAYS ABSENT rather than becoming an empty array. It is
    // empty for every anonymous traveler, so turning absence into a
    // repair would put a line in the log on every healthy job.
    check(
      "a bad visited_countries is dropped entirely",
      normalized({ visited_countries: "Italy" })?.visited_countries === undefined
    );
    check(
      "a real one is kept",
      JSON.stringify(normalized({ visited_countries: ["Italy", 7] })?.visited_countries) === '["Italy"]'
    );
  }

  section("the dates, which decide what gets paid for");

  {
    check("no dates is refused", refusedBecause({ ...good, start_date: undefined, end_date: undefined }) !== null);
    check(
      "a date that is not a date is refused",
      refusedBecause({ ...good, start_date: "soon", end_date: "later" }) !== null
    );
    check(
      "and so is one real date with one that is not",
      refusedBecause({ ...good, end_date: "next week" }) !== null
    );
    check(
      "the wrong way round is refused",
      refusedBecause({ ...good, start_date: DATES[1], end_date: DATES[0] }) !== null
    );
    check(
      "a same-day trip is fine",
      refusedBecause({ ...good, start_date: DATES[0], end_date: DATES[0] }) === null
    );
    // 2027-02-30 parses as a Date in some readings and must not here: it is
    // the shape parseCalendarDate exists for.
    check("an impossible calendar date is refused", refusedBecause({ ...good, start_date: "2027-02-30" }) !== null);
  }

  section("the scalars");

  {
    check('party_size "2" reads as 2', normalized({ party_size: "2" })?.party_size === 2);
    check("party_size 0 falls back to 1", normalized({ party_size: 0 })?.party_size === 1);
    check("party_size 2.7 truncates", normalized({ party_size: 2.7 })?.party_size === 2);
    check("party_size NaN falls back to 1", normalized({ party_size: Number.NaN })?.party_size === 1);
    check("party_size null falls back to 1", normalized({ party_size: null })?.party_size === 1);

    check('budget "3000" reads as 3000', normalized({ budget_total_eur: "3000" })?.budget_total_eur === 3000);
    check("budget null stays null", normalized({ budget_total_eur: null })?.budget_total_eur === null);
    check("a negative budget becomes null", normalized({ budget_total_eur: -5 })?.budget_total_eur === null);
    check("a NaN budget becomes null", normalized({ budget_total_eur: Number.NaN })?.budget_total_eur === null);
    check('a "free" budget becomes null', normalized({ budget_total_eur: "free" })?.budget_total_eur === null);

    check("an unknown pace falls back to moderate", normalized({ pace: "brisk" })?.pace === "moderate");
    check("a known pace is kept", normalized({ pace: "packed" })?.pace === "packed");
    check("an unknown language falls back to en", normalized({ language: "xx" })?.language === "en");
    check("bg is kept", normalized({ language: "bg" })?.language === "bg");
    check(
      "an unknown transport preference is dropped",
      normalized({ transport_preference: "hovercraft" })?.transport_preference === undefined
    );
    check(
      "a known one is kept",
      normalized({ transport_preference: "taxi_rideshare" })?.transport_preference === "taxi_rideshare"
    );

    // "Defaults to true" is what the field comments on both of these say,
    // and the direction matters: a malformed needs_lodging that read as
    // false would silently drop every bed from the trip and from the
    // budget.
    check("needs_lodging missing defaults to true", normalized({ needs_lodging: undefined })?.needs_lodging === true);
    check("needs_lodging 0 defaults to true", normalized({ needs_lodging: 0 })?.needs_lodging === true);
    check("an explicit false is respected", normalized({ needs_lodging: false })?.needs_lodging === false);
    check("needs_flight the same", normalized({ needs_flight: undefined })?.needs_flight === true);

    check("a numeric origin becomes absence", normalized({ origin: 42 })?.origin === undefined);
    check("a blank origin becomes absence", normalized({ origin: "   " })?.origin === undefined);
    check("a real origin is trimmed", normalized({ origin: " Sofia " })?.origin === "Sofia");
    check(
      "a numeric arrival_time becomes absence",
      normalized({ arrival_time: 1300 })?.arrival_time === undefined
    );
  }

  section("what it says it repaired");

  {
    const out = checkBrief({ ...good, interests: "food", party_size: "2" });
    check("the repairs are named", out.ok && out.repaired.includes("interests") && out.repaired.includes("party_size"), out.ok ? out.repaired.join(", ") : "");
    check("and nothing else is", out.ok && out.repaired.length === 2, out.ok ? out.repaired.join(", ") : "");
  }

  section("and through the real processJob");

  {
    // Each of these used to throw. Three of them escaped processJob
    // entirely, leaving the record at "running" with nothing to poll.
    const crashers: [string, unknown][] = [
      ["an empty brief", {}],
      ["destinations as a string", { ...good, destinations: "Rome" }],
      ["a null inside destinations", { ...good, destinations: [null, "Rome"] }],
      ["interests as a string", { ...good, interests: "food" }],
      ["must_see null", { ...good, must_see: null }],
      ["dates that are not dates", { ...good, start_date: "soon", end_date: "later" }],
    ];
    for (const [label, b] of crashers) {
      const out = await through(b);
      check(`${label}: nothing escapes`, out.escaped === "", out.escaped);
      check(`${label}: the job is written back`, out.status !== "(no record)", out.status);
      check(
        `${label}: and never the catch-all sentence`,
        out.error !== "Unexpected error generating itinerary.",
        `${out.status}: ${out.error}`
      );
    }
  }

  {
    // The two that are repairable really do finish, rather than being
    // refused with a tidy message. A gate that turns every odd brief into
    // an error page is a different way of losing the trip.
    const ok = await through({ ...good, interests: "food", must_see: null, party_size: "2" });
    check("a repairable brief still produces a trip", ok.status === "done", `${ok.status}: ${ok.error}`);
    check(
      "and the stored brief is the normalized one",
      Array.isArray((ok.brief as TripBriefInput | undefined)?.interests),
      JSON.stringify((ok.brief as TripBriefInput | undefined)?.interests)
    );
  }

  section("the final write, insisting");

  {
    // set #1 is the "running" write; everything after it fails, which is
    // the shape that lost a paid itinerary. publishJob retries and then
    // gives up loudly - the job cannot be published when Redis will not
    // take it, but processJob must not throw, because runConsumer's
    // catch-and-continue is the only thing between that and a dropped
    // consumer.
    const out = await through(good, { setFailsAfter: 1 });
    check("processJob does not throw", out.escaped === "", out.escaped);
    check("the record is whatever last landed", out.status === "running", out.status);
  }

  {
    // The realistic case: the write fails once and then works. The
    // itinerary has to survive that, because nothing else will produce it
    // again.
    const id = `brief-${++ids}`;
    const store = new Map<string, string>();
    let sets = 0;
    const redis = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        sets++;
        // The second set is the first progress write or the publish
        // depending on timing, so fail every set from 2 until 3 and let
        // the retry land.
        if (sets >= 2 && sets <= 3) throw new Error("transient");
        store.set(k, v);
        return "OK";
      },
      expire: async () => 1,
      rpush: async () => 1,
      lpush: async () => 1,
      ltrim: async () => "OK",
      incrbyfloat: async () => "0",
      sadd: async () => 1,
      multi: () => {
        const chain: Record<string, unknown> = {};
        const self = new Proxy(chain, { get: (_t, p) => (p === "exec" ? async () => [] : () => self) });
        return self;
      },
    } as unknown as Redis;
    store.set(
      jobKey(id),
      JSON.stringify({ id, status: "pending", brief: good, createdAt: Date.now(), updatedAt: Date.now() })
    );
    let escaped = "";
    try {
      await processJob(redis, client(), id);
    } catch (e) {
      escaped = e instanceof Error ? e.message : String(e);
    }
    const job = JSON.parse(store.get(jobKey(id)) ?? "null") as Job | null;
    check("a transient write failure does not escape", escaped === "", escaped);
    check("and the itinerary is published on a retry", job?.status === "done", `${job?.status} ${job?.error ?? ""}`);
    check("with days on it", (job?.result?.days?.length ?? 0) === 2, String(job?.result?.days?.length));
  }

  finish();
}

void main();
