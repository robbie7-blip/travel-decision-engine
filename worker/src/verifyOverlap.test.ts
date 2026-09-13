// Does venue verification actually run alongside the day calls?
//
// The timing audit's floor is why this change exists: on the 102.4s run an
// INSTANT phase 1 still lands at 33.6s, because the stages after it do not
// care how fast it was. Verification and the two repair passes are 12 of
// those seconds, and a Places lookup for day 1's restaurant does not need
// day 3 to exist.
//
// Whether the overlap happens is a property of the code, not of the model
// or of Google - so it is measurable here, with fixed-duration stubs, the
// same way pipeline.test.ts measures the rest of the critical path. Every
// latency regression in this pipeline has been work that should overlap
// quietly running one stage after another, and each one was found by
// deploying and burning a paid generation to read a wall-clock number.
//
// TWO ASSERTIONS CARRY THIS, and the second matters more than the first:
//
//   1. A Places lookup starts BEFORE the last day call finishes. That is
//      the overlap, and without it the change did nothing.
//
//   2. NO VENUE IS LOOKED UP TWICE. The whole-itinerary pass still runs
//      after the per-day ones - it has to, because a refinement and the
//      single-call fallback produce no per-day callbacks - and it is
//      filtered by unverifiedVenueItems. If that filter is wrong, every
//      venue is re-looked-up and the change has ADDED a Places call per
//      item while claiming to save time. Spending money to look faster is
//      a worse outcome than the original problem, so it is asserted
//      directly rather than inferred from the clock.
//
// pipeline.test.ts stubs the model; this also stubs globalThis.fetch, so
// there is no key, no network and no cost on either side.
//
// Run: npm run test:verify-overlap

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { check, fakeMessages, finish, heading, section } from "./testutil";
import type { TripBriefInput } from "./types";

heading("verification alongside the day calls");

/** One model round-trip. */
const CALL_MS = 300;
/** One Places lookup. Long enough that re-verifying would be obvious in
 * the wall clock as well as in the call count. */
const PLACES_MS = 200;

/** Day calls are STAGGERED, which is what creates a window to overlap
 * into. Real days differ - different cities, different amounts to write -
 * and with every stub taking the same time "verification overlapped the
 * days" and "verification started the millisecond the days ended" are
 * indistinguishable. Day 1 returns fast, day 3 slowly. */
const DAY_MS = [CALL_MS, CALL_MS * 2, CALL_MS * 4];

const DATES = ["2027-05-01", "2027-05-02", "2027-05-03"];

const BRIEF: TripBriefInput = {
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: DATES[0],
  end_date: DATES[2],
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 2000,
  pace: "relaxed",
  interests: ["food"],
  must_see: [],
  dietary_constraints: [],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: false,
};

interface Span {
  kind: string;
  start: number;
  end: number;
  detail?: string;
}

/** Every day gets its OWN venue names, so a lookup can be attributed to a
 * day and a repeat is unambiguous. */
function dayJson(dayNumber: number): string {
  return JSON.stringify({
    day: dayNumber,
    date: DATES[dayNumber - 1],
    items: [
      {
        time: "08:30",
        type: "meal",
        title: `Breakfast at Cafe D${dayNumber}`,
        venue_name: `Cafe D${dayNumber}`,
        location: "Rome",
        cost_estimate_eur: 12,
        reasoning: "r",
        source_confidence: "inferred",
      },
      {
        time: "13:00",
        type: "meal",
        title: `Lunch at Trattoria D${dayNumber}`,
        venue_name: `Trattoria D${dayNumber}`,
        location: "Rome",
        cost_estimate_eur: 30,
        reasoning: "r",
        source_confidence: "inferred",
      },
      {
        time: "16:00",
        type: "activity",
        title: `Museum D${dayNumber}`,
        venue_name: `Museum D${dayNumber}`,
        location: "Rome",
        cost_estimate_eur: 15,
        reasoning: "r",
        source_confidence: "inferred",
      },
      {
        time: "20:00",
        type: "meal",
        title: `Dinner at Osteria D${dayNumber}`,
        venue_name: `Osteria D${dayNumber}`,
        location: "Rome",
        cost_estimate_eur: 40,
        reasoning: "r",
        source_confidence: "inferred",
      },
    ],
    feasibility_flag: null,
  });
}

function makeClient(spans: Span[]): Anthropic {
  let dayCalls = 0;
  return {
    messages: fakeMessages(async (params: { system?: unknown; messages?: { content?: string }[] }) => {
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
                : sys.includes("filling ONE missing meal")
                  ? "meal-repair"
                  : sys.includes("fixing ONE line")
                    ? "venue-repair"
                    : "other";

      // Which day this is, read off the prompt rather than a counter, so a
      // reordered wave cannot mislabel a span.
      let dayNumber = 0;
      if (kind === "day") {
        const content = String(params.messages?.[0]?.content ?? "");
        const m = /Day (\d+)/.exec(content);
        dayNumber = m ? Number(m[1]) : ++dayCalls;
      }

      const start = Date.now();
      const wait = kind === "day" ? (DAY_MS[dayNumber - 1] ?? CALL_MS) : CALL_MS;
      await new Promise((r) => setTimeout(r, wait));
      spans.push({ kind, start, end: Date.now(), detail: kind === "day" ? `day ${dayNumber}` : undefined });

      let text = "{}";
      switch (kind) {
        case "frame":
          text = JSON.stringify({
            budget_feasibility: { feasible: true, min_realistic_total_eur: 900, reasoning: "r" },
            trip_summary: "Three days in Rome.",
            key_decisions: [{ decision: "d", reasoning: "r", alternative_considered: "a", confidence: "high" }],
            things_to_skip: [{ item: "i", reasoning: "r" }],
            accommodation: [
              { city: "Rome", name: null, area: null, cost_per_night_eur: 120, source_confidence: "inferred", source_urls: [] },
            ],
          });
          break;
        case "plan":
          text = JSON.stringify({
            days: DATES.map((date, i) => ({
              day: i + 1,
              date,
              city: "Rome",
              theme: "t",
              include_lodging: i < DATES.length - 1,
              anchors: [`Museum D${i + 1} (afternoon)`],
              meals: ["breakfast", "lunch", "dinner"],
              transport_note: null,
            })),
          });
          break;
        case "day":
          text = dayJson(dayNumber || 1);
          break;
        case "lodging-rate":
        case "lodging-property":
          text = JSON.stringify({ cost_estimate_eur: 120, source_url: "https://example.com/h" });
          break;
        default:
          text = "{}";
      }
      return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
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

/** Places and the geocode, both through globalThis.fetch. Records every
 * venue queried, with when. */
function stubFetch(lookups: Span[]) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    const href = String(url);

    if (init?.method === "POST" && href.includes("places.googleapis.com")) {
      const start = Date.now();
      let queried = "";
      try {
        queried = String(JSON.parse(init.body ?? "{}").textQuery ?? "").split(",")[0].trim();
      } catch {
        queried = "";
      }
      await new Promise((r) => setTimeout(r, PLACES_MS));
      lookups.push({ kind: "places", start, end: Date.now(), detail: queried });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          places: [
            {
              displayName: { text: queried },
              location: { latitude: 41.9028, longitude: 12.4964 },
              rating: 4.6,
              userRatingCount: 500,
              businessStatus: "OPERATIONAL",
              googleMapsUri: `https://maps.google.com/?q=${encodeURIComponent(queried)}`,
              regularOpeningHours: { weekdayDescriptions: ["Monday: Open 24 hours"], periods: [] },
            },
          ],
        }),
      } as Response;
    }

    // The city geocode, which prewarmGeocodes fires at t=0.
    if (href.includes("geocoding-api.open-meteo.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ latitude: 41.9028, longitude: 12.4964 }] }),
      } as Response;
    }

    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function main() {
  const hadKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "stub-key";

  const spans: Span[] = [];
  const lookups: Span[] = [];
  const fetchStub = stubFetch(lookups);
  const store = new Map<string, string>();
  const job: Job = { id: "v1", status: "pending", brief: BRIEF, createdAt: Date.now(), updatedAt: Date.now() };
  store.set(jobKey("v1"), JSON.stringify(job));

  const startedAt = Date.now();
  try {
    await processJob(makeRedis(store), makeClient(spans), "v1");
  } finally {
    fetchStub.restore();
    if (hadKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = hadKey;
  }
  const totalMs = Date.now() - startedAt;

  const finished: Job = JSON.parse(store.get(jobKey("v1"))!);
  const dayCalls = spans.filter((s) => s.kind === "day");
  const lastDayEnded = Math.max(...dayCalls.map((s) => s.end));

  section("the run is still a good run");

  check("it finished", finished.status === "done", `${finished.status}: ${finished.error ?? ""}`);
  check("all three days are there", (finished.result?.days ?? []).length === 3, String((finished.result?.days ?? []).length));
  check("all three day calls happened", dayCalls.length === 3, String(dayCalls.length));
  check("and Places was actually consulted", lookups.length > 0, String(lookups.length));

  section("verification overlapped the day calls");

  {
    // The overlap itself: a lookup that started while a day call was
    // still running. Without the change, the first Places request cannot
    // happen until every day has landed.
    const overlapping = lookups.filter((l) => l.start < lastDayEnded);
    check(
      "a Places lookup started before the last day call finished",
      overlapping.length > 0,
      `${overlapping.length}/${lookups.length} lookups began inside the day window`
    );
    check(
      "and it was most of them, not one straggler",
      overlapping.length >= Math.floor(lookups.length / 2),
      `${overlapping.length}/${lookups.length}`
    );
  }

  {
    // Day 1 returns in 300ms and day 3 in 1200ms, so day 1's four venues
    // have ~900ms of window. Attributed by name, because the point is
    // that an EARLY day's verification ran during a LATE day's call.
    const dayThree = dayCalls.find((s) => s.detail === "day 3");
    const dayOneLookups = lookups.filter((l) => (l.detail ?? "").endsWith("D1"));
    check("day 1's venues were looked up", dayOneLookups.length > 0, String(dayOneLookups.length));
    check(
      "while day 3 was still generating",
      dayThree !== undefined && dayOneLookups.some((l) => l.start < dayThree.end),
      `day 3 ended at +${(dayThree?.end ?? 0) - startedAt}ms, day 1 lookups began at ${dayOneLookups
        .map((l) => `+${l.start - startedAt}ms`)
        .join(", ")}`
    );
  }

  section("nothing is verified twice");

  {
    // The assertion that matters most. The whole-itinerary pass still runs
    // after the per-day ones, filtered by unverifiedVenueItems - and if
    // that filter is wrong every venue is looked up again, which ADDS a
    // Places call per item while claiming to save time.
    const byVenue = new Map<string, number>();
    for (const l of lookups) byVenue.set(l.detail ?? "", (byVenue.get(l.detail ?? "") ?? 0) + 1);
    const repeated = [...byVenue.entries()].filter(([, n]) => n > 1);
    check(
      "each venue was looked up exactly once",
      repeated.length === 0,
      repeated.map(([name, n]) => `${name} x${n}`).join(", ")
    );

    // Twelve named venues across three days. A replacement venue from a
    // repair legitimately adds one, so this is an upper bound rather than
    // an equality - the per-venue count above is the strict half.
    check(
      "and the total lookup count is bounded by the itinerary",
      lookups.length <= 16,
      `${lookups.length} lookups for 12 named venues`
    );
  }

  section("and the clock agrees");

  {
    // Serial would be every day call in sequence... no: the days already
    // run in parallel, so the shape to beat is
    // phase1 -> max(days) -> verification -> repairs. With the overlap,
    // verification disappears into the day window and the total loses it.
    const verifySerialFloor = CALL_MS /* phase 1 */ + DAY_MS[2] + PLACES_MS * 2 + CALL_MS /* repairs */;
    check(
      "the total is under what a serial verify stage would cost",
      totalMs < verifySerialFloor + PLACES_MS * 4,
      `${totalMs}ms`
    );
  }

  section("and the timings say what happened");

  {
    const t = finished.timings;
    check("venue verification is timed on its own", (t?.venuesMs ?? 0) > 0, String(t?.venuesMs));
    check("the meal repairs are timed apart from it", t?.mealRepairMs != null, String(t?.mealRepairMs));
    check(
      "and the residual says how much did not fit in the window",
      t?.verifyResidualMs != null,
      String(t?.verifyResidualMs)
    );
    // Staggered days leave a real window, so most of the work should have
    // landed inside it.
    check(
      "which is less than the verification cost",
      (t?.verifyResidualMs ?? Infinity) < (t?.venuesMs ?? 0),
      `residual ${t?.verifyResidualMs}ms of ${t?.venuesMs}ms`
    );
  }

  finish();
}

main();
