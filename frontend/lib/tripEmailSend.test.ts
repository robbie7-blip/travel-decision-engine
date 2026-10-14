// "Email me when it's ready" sends exactly once, never early, and never
// loses the request to a failed send.
//
// Run: npm run test:trip-ready

import assert from "node:assert/strict";
import { deliverTripReady } from "./tripEmailSend";
import { jobKey, readTripReadyNotify, tripReadyNotifyKey } from "./jobs";

async function main() {
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "decide <trips@example.com>";

  // Resend, in the test: records who was mailed, and can be told to fail.
  const sent: string[] = [];
  let resendStatus = 200;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    if (resendStatus !== 200) return new Response(JSON.stringify({ message: "nope" }), { status: resendStatus });
    sent.push(JSON.parse(init?.body ?? "{}").to);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  // Redis, in the test.
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    getdel: async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    },
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
  } as never;

  const job = (status: string) =>
    JSON.stringify({
      id: "j1",
      status,
      createdAt: 1,
      updatedAt: 1,
      brief: { destinations: ["Lisbon"], language: "en" },
      result:
        status === "done"
          ? { trip_summary: "", key_decisions: [], things_to_skip: [], budget_feasibility: {}, days: [] }
          : undefined,
    });
  const request = JSON.stringify({ email: "me@example.com", url: "https://yourdecide.com/api/trip-email/ready", requestedAt: 1 });

  // Still running: an early or stray ping does nothing and does NOT use
  // the request up.
  store.set(jobKey("j1"), job("running"));
  store.set(tripReadyNotifyKey("j1"), request);
  assert.equal(await deliverTripReady(redis, "j1", "https://yourdecide.com"), "not-done");
  assert.ok(store.has(tripReadyNotifyKey("j1")), "request survives an early ping");
  assert.equal(sent.length, 0);

  // Done: sent once, to the address the session wrote...
  store.set(jobKey("j1"), job("done"));
  assert.equal(await deliverTripReady(redis, "j1", "https://yourdecide.com"), "sent");
  assert.deepEqual(sent, ["me@example.com"]);
  // ...and a second ping (the worker AND the notify route both arriving)
  // sends nothing.
  assert.equal(await deliverTripReady(redis, "j1", "https://yourdecide.com"), "nothing-pending");
  assert.equal(sent.length, 1);

  // A failed send puts the request back, so it can be tried again.
  store.set(tripReadyNotifyKey("j1"), request);
  resendStatus = 500;
  await assert.rejects(() => deliverTripReady(redis, "j1", "https://yourdecide.com"));
  assert.ok(store.has(tripReadyNotifyKey("j1")), "request restored after a failed send");
  resendStatus = 200;
  assert.equal(await deliverTripReady(redis, "j1", "https://yourdecide.com"), "sent");
  assert.equal(sent.length, 2);

  // The worker only ever pings our own route.
  assert.equal(readTripReadyNotify(request)?.url, "https://yourdecide.com/api/trip-email/ready");
  assert.equal(readTripReadyNotify(request.replace("/api/trip-email/ready", "/somewhere-else")), null);
  assert.equal(readTripReadyNotify(request.replace("https:", "file:")), null);
  assert.equal(readTripReadyNotify(request.replace("me@example.com", "not-an-address")), null);
  assert.equal(readTripReadyNotify("{broken"), null);

  console.log("tripEmailSend: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
