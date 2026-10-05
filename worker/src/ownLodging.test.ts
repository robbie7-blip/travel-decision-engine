// A traveler who already has a bed must not be sold another one.
//
// Reported from a real Rome trip, with the hotel supplied on the form:
// the itinerary recommended a different hotel, and the timing panel showed
// "accommodation lookup 17.9s" inside a 73.6s generation. Both halves of
// that are the same bug.
//
// The PROMPT was never wrong. It says, in so many words, "do NOT include
// any accommodation line items", and when the traveler names where they
// are staying it adds "do NOT price it, describe it, or add it as a line
// item - it's given only for logistics". The frame stage is told to return
// an empty accommodation array for such a brief.
//
// The PIPELINE then went and looked hotels up anyway. The live lookup was
// gated on the lodging CACHE - "is this city missing?" - and never on
// whether the trip needed lodging at all, so every uncached city got a
// real web search. Its results were folded into the skeleton's
// accommodation list and handed to the day calls. A prohibition in the
// instructions and a dataset in the context point opposite ways, and a
// model that believes the data is not misbehaving; it is reading what we
// gave it.
//
// So this fixes the thing a prompt tweak cannot: there is nothing to
// resist if the hotels are never fetched. It is also the cheapest latency
// win available on these trips - a whole stage removed from the critical
// path, 17.9s on the run that prompted it.
//
// Two scenarios, because the lookup has two doors. One is the live search
// (no cache); the other is the cache itself, which a previous traveler's
// trip may have filled for free and which would otherwise put hotels back
// in front of the day calls on a brief that forbids them.
//
// Run: npm run test:own-lodging

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { writeCachedLodgingFact } from "./lodgingCache";
import { check, fakeMessages, finish, section } from "./testutil";
import type { TripBriefInput } from "./types";

const DESTINATION = "Rome";
const HOTEL = "Hotel Artemide";
/** The hotel a PREVIOUS traveler's trip left in the lodging cache. */
const CACHED_HOTEL = "Hotel Somewhere Else";

function briefFor(needsLodging: boolean): TripBriefInput {
  return {
    destinations: [DESTINATION],
    origin: "Sofia",
    start_date: "2027-03-18",
    end_date: "2027-03-20",
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
    needs_lodging: needsLodging,
    needs_flight: false,
    ...(needsLodging ? {} : { accommodation_location: HOTEL }),
  };
}

function frameJson(): string {
  return JSON.stringify({
    trip_summary: "A short Rome trip.",
    budget_feasibility: {
      feasible: true,
      min_realistic_total_eur: 900,
      reasoning: "r",
      verdict_line: "v",
    },
    key_decisions: [{ decision: "Stay central", why: "Short trip", tradeoff: "Costs more" }],
    things_to_skip: [{ thing: "Day trip", why: "Too far" }],
    accommodation: [],
  });
}

/** The realistic misbehaviour. twoPhase only forces include_lodging to
 * false when the model DIDN'T supply a boolean, so a plan that asserts
 * include_lodging: true on a brief that needs no lodging is the one case
 * where accommodationFromLodging still has cities to fill - from the
 * cache, for free, with no lookup to gate. This is what the second half of
 * the fix is for, and without this scenario that half is unprovable. */
function disobedientPlanJson(): string {
  return JSON.stringify({
    days: [
      { day: 1, date: "2027-03-18", city: DESTINATION, theme: "Arrive", include_lodging: true, anchors: [] },
      { day: 2, date: "2027-03-19", city: DESTINATION, theme: "Centre", include_lodging: true, anchors: [] },
      { day: 3, date: "2027-03-20", city: DESTINATION, theme: "Depart", include_lodging: false, anchors: [] },
    ],
  });
}

function planJson(): string {
  return JSON.stringify({
    days: [
      { day: 1, date: "2027-03-18", city: DESTINATION, theme: "Arrive", include_lodging: false, anchors: [] },
      { day: 2, date: "2027-03-19", city: DESTINATION, theme: "Centre", include_lodging: false, anchors: [] },
      { day: 3, date: "2027-03-20", city: DESTINATION, theme: "Depart", include_lodging: false, anchors: [] },
    ],
  });
}

/** What the SINGLE-CALL path returns: the frame's fields and the days in
 * one object. Used only in the forced-fallback scenario, where phase 1 is
 * made unusable on purpose. */
function wholeItineraryJson(): string {
  const base = JSON.parse(frameJson());
  const dates = ["2027-03-18", "2027-03-19", "2027-03-20"];
  return JSON.stringify({
    ...base,
    days: dates.map((date, i) => JSON.parse(dayJson(i + 1, date))),
  });
}

function dayJson(day: number, date: string): string {
  return JSON.stringify({
    day,
    date,
    items: [
      {
        time: "09:00",
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

/** Everything the run SENT, so the test can assert on what the model was
 * asked as well as on what came back. Both halves are captured: the brief
 * block rides in the user message, not the system prompt, which is where
 * the first version of this test looked and found nothing. */
interface Seen {
  kinds: string[];
  systems: string[];
  prompts: string[];
  /** Serialized `tools` per call, so the test can assert on what the model
   * was HANDED, not only what it was told. */
  tools: string[];
}

function makeClient(seen: Seen, disobedient = false, forceFallback = false): Anthropic {
  let dayIndex = 0;
  const dates = ["2027-03-18", "2027-03-19", "2027-03-20"];
  return {
    messages: fakeMessages(async (params: { system?: unknown; messages?: unknown; tools?: unknown }) => {
      const sys = JSON.stringify(params.system ?? "");
      seen.systems.push(sys);
      seen.prompts.push(JSON.stringify(params.messages ?? ""));
      seen.tools.push(JSON.stringify((params as { tools?: unknown }).tools ?? ""));
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
                : "other";
      seen.kinds.push(kind);
      const text = ((): string => {
        switch (kind) {
          case "frame":
            return forceFallback ? "not json at all" : frameJson();
          case "plan":
            return disobedient ? disobedientPlanJson() : planJson();
          case "day": {
            const i = dayIndex++;
            return dayJson(i + 1, dates[i] ?? dates[dates.length - 1]);
          }
          case "lodging-rate":
            return JSON.stringify({ cost_estimate_eur: 180, source_url: "https://example.com/rate" });
          case "lodging-property":
            // The hotel the traveler did NOT book. If this ever reaches the
            // itinerary on a needs_lodging: false brief, that is the defect.
            return JSON.stringify({ name: "Hotel Somewhere Else", area: "Termini" });
          default:
            // The single-call fallback lands here: it carries no STAGE
            // marker, because it is the whole itinerary in one request.
            return forceFallback ? wholeItineraryJson() : "{}";
        }
      })();
      // The real client returns a Message, and the pipeline reads
      // content[0].text and stop_reason off it - a bare string is a client
      // that does not exist.
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
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    setex: async (k: string, _ttl: number, v: string) => {
      store.set(k, v);
      return "OK";
    },
    lpush: async () => 1,
    ltrim: async () => "OK",
    expire: async () => 1,
    incrby: async () => 1,
    incr: async () => 1,
    hincrby: async () => 1,
    hgetall: async () => ({}),
    lrange: async () => [],
    keys: async (pattern: string) => [...store.keys()].filter((k) => k.startsWith(pattern.replace("*", ""))),
    multi: () => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get: (_t, prop) => (prop === "exec" ? async () => [] : () => self),
      });
      return self;
    },
  } as unknown as Redis;
}

async function run(label: string, needsLodging: boolean, seedCache = false, disobedient = false, forceFallback = false) {
  section(label);
  const store = new Map<string, string>();
  const id = `own-lodging-${needsLodging ? "needs" : "has"}-${seedCache ? "cached" : "cold"}${disobedient ? "-disobedient" : ""}`;
  const job: Job = {
    id,
    status: "pending",
    brief: briefFor(needsLodging),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.set(jobKey(id), JSON.stringify(job));

  const redis = makeRedis(store);
  if (seedCache) {
    // A previous traveler's Rome trip. Reading this costs nothing, so no
    // budget or latency consideration would stop it being folded in - only
    // an explicit check on the brief does.
    await writeCachedLodgingFact(redis, DESTINATION, {
      costEstimateEur: 190,
      name: CACHED_HOTEL,
      area: "Termini",
      sourceUrls: ["https://example.com/cached"],
      sourceAgreement: null,
    });
  }

  const seen: Seen = { kinds: [], systems: [], prompts: [], tools: [] };
  await processJob(redis, makeClient(seen, disobedient, forceFallback), id);
  const finished: Job = JSON.parse(store.get(jobKey(id))!);

  check("the job completed", finished.status === "done", finished.status);
  return { finished, seen };
}

// tsx compiles to CJS, where top-level await does not exist - every
// suite in this directory wraps its run the same way.
async function main() {
  section("a traveler who already has a hotel");

  {
    const { finished, seen } = await run("needs_lodging: false, nothing cached", false);

    const lodgingCalls = seen.kinds.filter((k) => k.startsWith("lodging-"));
    check(
      "no hotel lookup was made at all",
      lodgingCalls.length === 0,
      `${lodgingCalls.length} lodging call(s): ${lodgingCalls.join(", ")}`
    );

    const lodgingItems = (finished.result?.days ?? []).flatMap((d) =>
      (d.items ?? []).filter((i) => i.type === "lodging")
    );
    check(
      "no day carries a lodging line item",
      lodgingItems.length === 0,
      JSON.stringify(lodgingItems).slice(0, 200)
    );

    const blob = JSON.stringify(finished.result ?? {});
    check(
      "the hotel the traveler did NOT book appears nowhere",
      !blob.includes("Hotel Somewhere Else"),
      "a looked-up hotel reached the itinerary"
    );

    // The prompt half, which was always right and must stay right: the brief
    // still names where the traveler sleeps, because sequencing depends on it
    // even though pricing must not. Dropping the lookup must not drop this.
    check(
      "the model is still told where they are staying",
      seen.prompts.some((p) => p.includes(HOTEL)),
      `the accommodation_location reached none of the ${seen.prompts.length} prompt(s)`
    );
  }

  {
    // The second door. A previous traveler's Rome trip fills the lodging
    // cache; reading it is free, so nothing about cost would stop it being
    // folded in here. It must still not be.
    const { finished, seen } = await run(
      "needs_lodging: false, with the city already in the lodging cache",
      false,
      true
    );

    const lodgingCalls = seen.kinds.filter((k) => k.startsWith("lodging-"));
    check("still no hotel lookup", lodgingCalls.length === 0, lodgingCalls.join(", "));
    const lodgingItems = (finished.result?.days ?? []).flatMap((d) =>
      (d.items ?? []).filter((i) => i.type === "lodging")
    );
    check("still no lodging line item", lodgingItems.length === 0, JSON.stringify(lodgingItems).slice(0, 160));
  }

  {
    // The model ignores the instruction and marks nights at a hotel anyway,
    // with the city already cached. Nothing here needs a lookup, so the
    // lookup gate cannot help: only the brief check on the accommodation
    // itself stops a cached hotel being handed to the day calls.
    const { finished, seen } = await run(
      "needs_lodging: false, cached city, and a plan that asks for lodging anyway",
      false,
      true,
      true
    );
    const lodgingItems = (finished.result?.days ?? []).flatMap((d) =>
      (d.items ?? []).filter((i) => i.type === "lodging")
    );
    check(
      "a disobedient plan still yields no lodging line item",
      lodgingItems.length === 0,
      JSON.stringify(lodgingItems).slice(0, 160)
    );
    check(
      "and the cached hotel never reaches the itinerary",
      !JSON.stringify(finished.result ?? {}).includes(CACHED_HOTEL),
      "a cached hotel reached a trip that did not need one"
    );
    // The assertion that matters most, and the one the first version of
    // this suite was missing: not just "it stayed out of the output" but
    // "the model was never shown it". Checking the output alone passes
    // whenever the model happens to behave, which is exactly the kind of
    // test that lets this bug back in.
    check(
      "and the model was never SHOWN the cached hotel",
      !seen.prompts.some((p) => p.includes(CACHED_HOTEL)) &&
        !seen.systems.some((p) => p.includes(CACHED_HOTEL)),
      "a cached hotel was injected into the prompt of a trip that needs no lodging"
    );
  }

  {
    // The single-call fallback, which the two-phase path drops to when
    // phase 1 fails. It is the ONLY generation call that can carry a
    // web_search tool, and that tool exists for exactly one purpose:
    // pricing lodging. On a trip that needs none it is latency and an
    // invitation, so it must not be attached - and the instruction block
    // beside it must not claim cached figures that do not exist.
    const { seen } = await run("needs_lodging: false, forced down the single-call path", false, false, false, true);
    const searchy = seen.tools.filter((t) => t.includes("web_search"));
    check(
      "the fallback call attaches no web_search tool",
      searchy.length === 0,
      `${searchy.length} call(s) carried a search tool`
    );
    check(
      "and is not told that lodging prices were already verified",
      !seen.systems.some((p) => p.includes("already been verified")),
      "the no-search text claimed cached lodging figures on a trip with none"
    );
  }

  section("the ordinary case still works");

  {
    // The guard rail on the fix: a trip that DOES need a bed must still get
    // one. A fix that silenced accommodation everywhere would pass every
    // assertion above and ship a product that never books anyone a hotel.
    const { finished, seen } = await run("needs_lodging: true", true);
    const lodgingCalls = seen.kinds.filter((k) => k.startsWith("lodging-"));
    check(
      "the hotel lookup still runs when lodging IS needed",
      lodgingCalls.length > 0,
      "no lodging call was made on a brief that needs lodging"
    );
    check("the job still completed", finished.status === "done", finished.status);
  }

  finish();
}

void main();
