// Run: npm run test:home-daily

import assert from "node:assert/strict";
import { lastUtcDays, loadHomeDaily, recordHomeEvent } from "./analytics";
import { HOME_EVENT_TYPES } from "./homeEvents";

async function main() {
  // Dates are UTC and today first, including across a month end.
  assert.deepEqual(lastUtcDays(new Date("2026-11-01T01:00:00Z"), 3), ["2026-11-01", "2026-10-31", "2026-10-30"]);

  // A small Redis: enough for the pipeline and mget the counters use.
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();
  const redis = {
    pipeline() {
      const ops: (() => void)[] = [];
      const p = {
        incr: (k: string) => (ops.push(() => store.set(k, (store.get(k) ?? 0) + 1)), p),
        expire: (k: string, s: number) => (ops.push(() => ttls.set(k, s)), p),
        exec: async () => ops.forEach((op) => op()),
      };
      return p;
    },
    mget: async (...keys: string[]) => keys.map((k) => store.get(k) ?? null),
  } as never;

  await recordHomeEvent(redis, "submit_bar");
  await recordHomeEvent(redis, "submit_bar");
  await recordHomeEvent(redis, "nudge_shown");

  const today = lastUtcDays(new Date(), 1)[0];
  assert.equal(store.get("analytics:home:submit_bar:total"), 2);
  assert.equal(store.get(`analytics:home:submit_bar:day:${today}`), 2);
  // Every day key expires; totals do not.
  assert.ok([...ttls.keys()].every((k) => k.includes(":day:")));
  assert.ok(!ttls.has("analytics:home:submit_bar:total"));

  const daily = await loadHomeDaily(redis, 3);
  assert.equal(daily.length, 3);
  assert.equal(daily[0].day, today);
  assert.equal(daily[0].counts.submit_bar, 2);
  assert.equal(daily[0].counts.nudge_shown, 1);
  assert.equal(daily[1].counts.submit_bar, 0);
  assert.deepEqual(Object.keys(daily[0].counts).sort(), [...HOME_EVENT_TYPES].sort());

  console.log("homeDaily: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
