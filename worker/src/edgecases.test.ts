// Runs the real pipeline over the trip shapes nothing else covers.
//
// Every other suite tests a three-day, single-city, English trip with a
// flight and a hotel. That is one point in a space the product actually
// serves, and the branches the other shapes take — a second city, a
// Bulgarian itinerary, a brief that says the hotel is already booked —
// have never been executed end to end by anything.
//
// Untested branches are where the next silly mistake lives, and these cost
// nothing to run.
//
// Run: npm run test:edges

import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import { processJob } from "./index";
import { jobKey, type Job } from "./jobs";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, TripBriefInput } from "./types";

function briefOf(over: Partial<TripBriefInput>): TripBriefInput {
  return {
    destinations: ["Rome"],
    origin: "Sofia",
    start_date: "2026-11-06",
    end_date: "2026-11-08",
    party_size: 2,
    party_composition: "couple",
    budget_total_eur: 2000,
    pace: "moderate",
    interests: ["food"],
    must_see: [],
    dietary_constraints: [],
    mobility_constraints: [],
    hard_no: [],
    language: "en",
    needs_lodging: true,
    needs_flight: true,
    ...over,
  };
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  for (let t = a; t <= b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

interface Shape {
  brief: TripBriefInput;
  /** Which city each day sits in — drives the multi-city fixtures. */
  cityForDay: (i: number, total: number) => string;
}

function stubFor(shape: Shape) {
  const { brief } = shape;
  const dates = daysBetween(brief.start_date, brief.end_date);
  const bg = brief.language === "bg";
  const cities = brief.destinations;

  const label = {
    breakfast: bg ? "Закуска в" : "Breakfast at",
    lunch: bg ? "Обяд в" : "Lunch at",
    dinner: bg ? "Вечеря в" : "Dinner at",
    night: bg ? "Нощувка в" : "Night at",
    checkin: bg ? "Настаняване в" : "Check in to",
    sight: bg ? "Разходка до" : "Visit",
  };

  const plan = () =>
    JSON.stringify({
      days: dates.map((date, i) => ({
        day: i + 1,
        date,
        city: shape.cityForDay(i, dates.length),
        theme: "t",
        include_lodging: brief.needs_lodging && i < dates.length - 1,
        anchors: [`${label.sight} Sight ${i + 1}`],
        meals: ["breakfast", "lunch", "dinner"],
        transport_note:
          brief.needs_flight && (i === 0 || i === dates.length - 1) ? "Flight" : null,
      })),
    });

  const frame = () =>
    JSON.stringify({
      budget_feasibility: { feasible: true, min_realistic_total_eur: 600, reasoning: "r" },
      trip_summary: bg ? "Кратко пътуване." : "A short trip.",
      key_decisions: [],
      things_to_skip: [],
      accommodation: brief.needs_lodging
        ? cities.map((city, i) => ({
            city,
            name: `Hotel ${i + 1}`,
            area: "Centre",
            cost_per_night_eur: 90 + i * 10,
            source_confidence: "grounded",
            source_urls: ["https://example.com/rate"],
          }))
        : [],
    });

  const day = (n: number) => {
    const city = shape.cityForDay(n - 1, dates.length);
    const items: Record<string, unknown>[] = [
      { time: "08:00", type: "meal", title: `${label.breakfast} Cafe ${n}`, venue_name: `Cafe ${n}`, location: `Centre, ${city}`, cost_estimate_eur: 10, reasoning: "r", source_confidence: "inferred" },
      { time: "10:30", type: "activity", title: `${label.sight} Sight ${n}`, venue_name: `Sight ${n}`, location: `Centre, ${city}`, cost_estimate_eur: 15, reasoning: "r", source_confidence: "inferred" },
      { time: "13:00", type: "meal", title: `${label.lunch} Trattoria ${n}`, venue_name: `Trattoria ${n}`, location: `Centre, ${city}`, cost_estimate_eur: 25, reasoning: "r", source_confidence: "inferred" },
      { time: "16:00", type: "activity", title: `${label.sight} Park ${n}`, venue_name: `Park ${n}`, location: `Centre, ${city}`, cost_estimate_eur: 0, reasoning: "r", source_confidence: "inferred" },
      { time: "20:00", type: "meal", title: `${label.dinner} Osteria ${n}`, venue_name: `Osteria ${n}`, location: `Centre, ${city}`, cost_estimate_eur: 40, reasoning: "r", source_confidence: "inferred" },
    ];
    if (brief.needs_lodging && n < dates.length) {
      const idx = Math.max(0, cities.indexOf(city));
      items.push({
        time: "22:00",
        type: "lodging",
        title: `${n === 1 ? label.checkin : label.night} Hotel ${idx + 1}`,
        venue_name: `Hotel ${idx + 1}`,
        location: `Centre, ${city}`,
        cost_estimate_eur: 90 + idx * 10,
        reasoning: "r",
        source_confidence: "grounded",
        source_urls: ["https://example.com/rate"],
      });
    }
    if (brief.needs_flight && (n === 1 || n === dates.length)) {
      items.push({
        time: n === 1 ? "06:00" : "18:00",
        type: "transport",
        title: "Flight",
        venue_name: null,
        is_flight: true,
        location: `${brief.origin} to ${city}`,
        cost_estimate_eur: 150,
        reasoning: "r",
        source_confidence: "inferred",
      });
      items.push({
        time: n === 1 ? "07:30" : "16:30",
        type: "transport",
        title: bg ? "Влак до центъра" : "Train to the centre",
        venue_name: null,
        location: `Airport to ${city}`,
        cost_estimate_eur: 15,
        reasoning: "r",
        source_confidence: "inferred",
      });
    }
    return JSON.stringify({ day: n, date: dates[n - 1], items, feasibility_flag: null });
  };

  return { plan, frame, day, dates };
}

function makeClient(shape: Shape): Anthropic {
  const s = stubFor(shape);
  let repairs = 0;
  return {
    messages: {
      create: async (params: { system?: unknown; messages?: { content?: unknown }[] }) => {
        const system = JSON.stringify(params.system ?? "");
        const user = String(params.messages?.[0]?.content ?? "");
        let text = "{}";
        if (system.includes("STAGE 1A")) text = s.frame();
        else if (system.includes("STAGE 1B")) text = s.plan();
        else if (system.includes("STAGE 2")) {
          const m = /Day (\d+) —/.exec(user);
          text = s.day(m ? Number(m[1]) : 1);
        } else if (system.includes("price per night")) {
          text = JSON.stringify({ cost_estimate_eur: 90, source_url: "https://example.com/rate" });
        } else if (system.includes("well-reviewed mid-range hotel")) {
          const city = /City: (.+)/.exec(user)?.[1] ?? "";
          const idx = Math.max(0, shape.brief.destinations.indexOf(city.trim()));
          text = JSON.stringify({ name: `Hotel ${idx + 1}`, area: "Centre" });
        } else if (system.includes("fixing ONE line") || system.includes("filling ONE missing meal")) {
          repairs++;
          text = JSON.stringify({
            time: "20:00",
            title: `Repaired ${repairs}`,
            venue_name: `Repaired ${repairs}`,
            location: "Centre",
            cost_estimate_eur: 30,
            reasoning: "r",
          });
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

async function run(name: string, shape: Shape): Promise<Job> {
  const store = new Map<string, string>();
  const id = name.replace(/\W+/g, "-");
  store.set(
    jobKey(id),
    JSON.stringify({ id, status: "pending", brief: shape.brief, createdAt: Date.now(), updatedAt: Date.now() } satisfies Job)
  );
  await processJob(makeRedis(store), makeClient(shape), id);
  return JSON.parse(store.get(jobKey(id))!);
}

function defectsOf(job: Job): string[] {
  return (job.quality?.findings ?? []).filter((f) => f.severity === "defect").map((f) => f.detail);
}

async function main() {
  heading("TRIP SHAPES NOTHING ELSE COVERS");

  section("a Bulgarian itinerary");
  {
    const job = await run("bg", {
      brief: briefOf({ language: "bg" }),
      cityForDay: () => "Rome",
    });
    check("completes", job.status === "done", job.error ?? "");
    check("no defects", defectsOf(job).length === 0, defectsOf(job).join("; "));
    const items = (job.result as Itinerary).days.flatMap((d) => d.items);
    check(
      "Bulgarian meal titles are recognised as meals, so nothing is 'missing'",
      !defectsOf(job).some((d) => /has no /.test(d))
    );
    check("nothing was written in English by a repair", !items.some((i) => /^Repaired/.test(i.title)));
  }

  section("two cities");
  {
    const job = await run("two-cities", {
      brief: briefOf({ destinations: ["Rome", "Florence"], end_date: "2026-11-10" }),
      cityForDay: (i, total) => (i < Math.ceil(total / 2) ? "Rome" : "Florence"),
    });
    check("completes", job.status === "done", job.error ?? "");
    check("no defects", defectsOf(job).length === 0, defectsOf(job).join("; "));
    const lodging = (job.result as Itinerary).days.flatMap((d) => d.items.filter((i) => i.type === "lodging"));
    check("a bed for every night", lodging.length === 4, `${lodging.length}`);
    check(
      "each city's bed is priced with that city's rate, not the other's",
      lodging.every((i) => (i.location.includes("Rome") ? i.cost_estimate_eur === 90 : i.cost_estimate_eur === 100)),
      lodging.map((i) => `${i.location}=${i.cost_estimate_eur}`).join(" ")
    );
  }

  section("accommodation already arranged");
  {
    const job = await run("no-lodging", {
      brief: briefOf({ needs_lodging: false }),
      cityForDay: () => "Rome",
    });
    check("completes", job.status === "done", job.error ?? "");
    check("no defects", defectsOf(job).length === 0, defectsOf(job).join("; "));
    const lodging = (job.result as Itinerary).days.flatMap((d) => d.items.filter((i) => i.type === "lodging"));
    check("no accommodation invented", lodging.length === 0, `${lodging.length}`);
  }

  section("travel already booked");
  {
    const job = await run("no-flight", {
      brief: briefOf({ needs_flight: false, origin: "" }),
      cityForDay: () => "Rome",
    });
    check("completes", job.status === "done", job.error ?? "");
    check("no defects", defectsOf(job).length === 0, defectsOf(job).join("; "));
    check(
      "no missing-transport finding on a trip that never asked for it",
      !(job.quality?.findings ?? []).some((f) => f.check === "transport_legs")
    );
  }

  section("a single day");
  {
    const job = await run("one-day", {
      brief: briefOf({ start_date: "2026-11-06", end_date: "2026-11-06", needs_lodging: false }),
      cityForDay: () => "Rome",
    });
    check("completes", job.status === "done", job.error ?? "");
    check("exactly one day", (job.result as Itinerary).days.length === 1);
    check("no defects", defectsOf(job).length === 0, defectsOf(job).join("; "));
  }

  finish();
}

main();
