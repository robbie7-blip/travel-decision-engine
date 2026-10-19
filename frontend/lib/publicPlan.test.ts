// Run: npm run test:public-plan

import assert from "node:assert/strict";
import { publicItinerary } from "./publicPlan";

const full = {
  trip_summary: "Three days in Rome.",
  budget_feasibility: { feasible: false, min_realistic_total_eur: 900, reasoning: "Your 600 euros will not cover it." },
  key_decisions: [{ decision: "Step-free hotel for the wheelchair", reasoning: "x" }],
  things_to_skip: [{ item: "x", reasoning: "y" }],
  pushback_response: "Done.",
  days: [
    {
      day: 1,
      date: "2026-11-06",
      city: "Rome",
      feasibility_flag: "tight",
      items: [
        { time: "10:00", type: "transport", title: "Flight from Sofia", is_flight: true, reasoning: "Your flight." },
        { time: "15:00", type: "lodging", title: "Check in", venue_name: "Hotel Raphael" },
        { time: "17:00", type: "activity", title: "Pantheon", venue_name: "Pantheon", reasoning: "Free.", google_lat: 41.9, google_lng: 12.47, google_place_id: "abc", source_urls: ["https://x"] },
      ],
    },
  ],
};

const pub = publicItinerary(full) as unknown as Record<string, unknown> & { days: { items: Record<string, unknown>[] }[] };
for (const key of ["trip_summary", "budget_feasibility", "key_decisions", "things_to_skip", "pushback_response"]) assert.ok(!(key in pub), `no ${key}`);
assert.deepEqual(pub.days[0].items.map((i) => i.title), ["Check in", "Pantheon"], "no flight; decide's hotel suggestion stays");
assert.ok(!("reasoning" in pub.days[0].items[1]), "no line's why: it was written to the traveller");
assert.equal(pub.days[0].items[1].google_lat, 41.9, "the map still has its pins");
assert.ok(!("google_place_id" in pub.days[0].items[1]) && !("source_urls" in pub.days[0].items[1]), "only listed fields");
assert.ok(!JSON.stringify(pub).includes("600") && !JSON.stringify(pub).includes("wheelchair") && !JSON.stringify(pub).includes("Sofia"));
assert.deepEqual(publicItinerary(null), { days: [] }, "anything odd is an empty plan, not an error");
assert.deepEqual(publicItinerary({ days: [{ day: 1, items: "nope" }] }).days[0].items, []);

console.log("publicPlan: all assertions passed");
