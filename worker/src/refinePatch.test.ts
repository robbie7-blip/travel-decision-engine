// A pushback answered as edits: the pure half, then a real processJob.
//
// Run: npm run test:refine-patch

import type Redis from "ioredis";
import Anthropic from "@anthropic-ai/sdk";
import { applyRefinePatch, itineraryForPatch, parseRefinePatch, refOf } from "./engine/refinePatch";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { check, fakeMessages, finish, heading, section } from "./testutil";
import type { Itinerary, TripBriefInput } from "./types";

heading("pushback as edits");

const verifiedLunch = {
  time: "13:00",
  type: "meal",
  title: "Lunch at Armando al Pantheon",
  venue_name: "Armando al Pantheon",
  location: "Pantheon, Rome",
  cost_estimate_eur: 30,
  reasoning: "r",
  source_confidence: "grounded",
  source_urls: ["https://example.com"],
  google_rating: 4.6,
  google_rating_count: 3000,
  google_maps_url: "https://maps.google.com/?cid=1",
};
const coffee = {
  time: "08:30",
  type: "meal",
  title: "Coffee at Roscioli Caffè",
  venue_name: "Roscioli Caffè",
  location: "Campo de' Fiori, Rome",
  cost_estimate_eur: 5,
  reasoning: "r",
  source_confidence: "inferred",
};
const base = (): Itinerary =>
  ({
    trip_summary: "Two days in Rome.",
    budget_feasibility: { feasible: true, min_realistic_total_eur: 300, reasoning: "r" },
    key_decisions: [],
    things_to_skip: [],
    days: [
      { day: 1, date: "2027-03-18", city: "Rome", items: [JSON.parse(JSON.stringify(coffee)), JSON.parse(JSON.stringify(verifiedLunch))], feasibility_flag: null },
      { day: 2, date: "2027-03-19", city: "Rome", items: [], feasibility_flag: null },
    ],
  }) as unknown as Itinerary;

const newCoffee = {
  time: "08:30",
  type: "meal",
  title: "Coffee at Bar del Fico",
  venue_name: "Bar del Fico",
  location: "Piazza del Fico, Rome",
  cost_estimate_eur: 5,
  reasoning: "Two minutes from the guesthouse.",
  source_confidence: "inferred",
  google_maps_url: "https://made-up-by-the-model",
};

async function main() {
  section("parsing");
  check("refs are day.position, 1-based", refOf(2, 0) === "d2.1");
  const forModel = itineraryForPatch(base()) as { days: { items: Record<string, unknown>[] }[] };
  check("the model sees refs", forModel.days[0].items[1].ref === "d1.2");
  check("and not the Places fields it cannot improve", !("google_maps_url" in forModel.days[0].items[1]));
  check("no answer is not a patch", parseRefinePatch({ changes: [] }) === null);
  check("no changes list is not a patch", parseRefinePatch({ pushback_response: "x" }) === null);
  check("an unknown op is not a patch", parseRefinePatch({ pushback_response: "x", changes: [{ op: "move", ref: "d1.1" }] }) === null);
  check("an item without a title is not a patch", parseRefinePatch({ pushback_response: "x", changes: [{ op: "add", day: 1, item: { time: "1", type: "meal" } }] }) === null);
  check("standing firm is a patch with no changes", parseRefinePatch({ pushback_response: "No - here is why.", changes: [] })?.changes.length === 0);

  section("applying");
  {
    const patch = parseRefinePatch({
      pushback_response: "Fair - swapped for somewhere near you.",
      changes: [{ op: "replace", ref: "d1.1", item: newCoffee }, { op: "add", day: 2, item: { ...newCoffee, time: "09:00", title: "Coffee at Sant'Eustachio", venue_name: "Sant'Eustachio" } }],
    })!;
    const original = base();
    const applied = applyRefinePatch(original, patch)!;
    const day1 = applied.itinerary.days[0].items;
    check("the replaced line is the new one", day1[0].title === "Coffee at Bar del Fico");
    check("with no Places data the model made up", day1[0].google_maps_url === undefined);
    check("the untouched line keeps its verification", day1[1].google_maps_url === verifiedLunch.google_maps_url && day1[1].google_rating === 4.6);
    check("an added line lands on its day", applied.itinerary.days[1].items.length === 1);
    check("the answer is on the itinerary", applied.itinerary.pushback_response === "Fair - swapped for somewhere near you.");
    check("two changed lines reported", applied.changed.length === 2);
    check("the base itinerary is not mutated", original.days[0].items[0].title === coffee.title);
  }
  {
    const removed = applyRefinePatch(base(), parseRefinePatch({ pushback_response: "Dropped it.", changes: [{ op: "remove", ref: "d1.1" }] })!)!;
    check("remove takes the line out", removed.itinerary.days[0].items.length === 1 && removed.itinerary.days[0].items[0].title === verifiedLunch.title);
    check("an added line is sorted into the day", applyRefinePatch(base(), parseRefinePatch({ pushback_response: "x", changes: [{ op: "add", day: 1, item: { ...newCoffee, time: "10:00" } }] })!)!.itinerary.days[0].items[1].time === "10:00");
    check("an invented ref refuses the whole patch", applyRefinePatch(base(), parseRefinePatch({ pushback_response: "x", changes: [{ op: "remove", ref: "d9.9" }] })!) === null);
    check("a day the trip does not have refuses it", applyRefinePatch(base(), parseRefinePatch({ pushback_response: "x", changes: [{ op: "add", day: 7, item: newCoffee }] })!) === null);
    check("the same line twice refuses it", applyRefinePatch(base(), parseRefinePatch({ pushback_response: "x", changes: [{ op: "remove", ref: "d1.1" }, { op: "replace", ref: "d1.1", item: newCoffee }] })!) === null);
  }

  section("through processJob");
  const brief: TripBriefInput = {
    destinations: ["Rome"], origin: "Sofia", start_date: "2027-03-18", end_date: "2027-03-19", party_size: 2,
    party_composition: "couple", budget_total_eur: 3000, pace: "relaxed", interests: [], must_see: [],
    dietary_constraints: [], mobility_constraints: [], hard_no: [], language: "en", needs_lodging: false, needs_flight: false,
  };
  const run = async (patchReply: string) => {
    const store = new Map<string, string>();
    const answers: (string | undefined)[] = [];
    let fullRewrites = 0;
    const redis = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        if (k === jobKey("r1")) {
          const j = JSON.parse(v) as Job;
          if (j.status === "running" && j.progress?.answer) answers.push(j.progress.answer);
        }
        return "OK";
      },
      del: async () => 1, expire: async () => 1, rpush: async () => 1, lpush: async () => 1, ltrim: async () => "OK",
      incrbyfloat: async () => "0", sadd: async () => 1,
      multi: () => { const self: unknown = new Proxy({}, { get: (_t, p) => (p === "exec" ? async () => [] : () => self) }); return self; },
    } as unknown as Redis;
    const client = {
      messages: fakeMessages(async (params: { messages?: { content?: unknown }[] }) => {
        const prompt = JSON.stringify(params.messages ?? []);
        let text = "{}";
        if (prompt.includes("ONLY the edits")) text = patchReply;
        else if (prompt.includes("output the full itinerary again")) {
          fullRewrites++;
          text = JSON.stringify({ ...base(), pushback_response: "Rewrote it." });
        } else if (prompt.includes("violations")) text = JSON.stringify({ violations: [] });
        return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      }),
    } as unknown as Anthropic;
    store.set(jobKey("r1"), JSON.stringify({ id: "r1", status: "pending", brief, refinement: { question: "Coffee nearer the guesthouse?", baseItinerary: base() }, createdAt: Date.now(), updatedAt: Date.now() }));
    await processJob(redis, client, "r1");
    return { job: JSON.parse(store.get(jobKey("r1"))!) as Job, answers, fullRewrites };
  };

  {
    const { job, answers, fullRewrites } = await run(
      JSON.stringify({ pushback_response: "Fair - swapped for somewhere near you.", changes: [{ op: "replace", ref: "d1.1", item: newCoffee }] })
    );
    check("the pushback finishes", job.status === "done", `${job.status} ${job.error ?? ""}`);
    check("answered by edits, with no full rewrite", fullRewrites === 0, String(fullRewrites));
    check("the answer was published while it was still running", answers.includes("Fair - swapped for somewhere near you."), JSON.stringify(answers));
    const lunch = job.result?.days?.[0]?.items?.find((i) => i.title === verifiedLunch.title);
    check("the untouched lunch kept its map link", lunch?.google_maps_url === verifiedLunch.google_maps_url, JSON.stringify(lunch));
    check("the coffee is the new one", job.result?.days?.[0]?.items?.some((i) => i.title === "Coffee at Bar del Fico") === true);
    check("and the answer is on the result", job.result?.pushback_response === "Fair - swapped for somewhere near you.");
  }
  {
    const { job, fullRewrites } = await run("this is not json");
    check("an unusable reply falls back to the full rewrite", fullRewrites >= 1 && job.status === "done" && job.result?.pushback_response === "Rewrote it.", `${fullRewrites} ${job.status}`);
  }

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
