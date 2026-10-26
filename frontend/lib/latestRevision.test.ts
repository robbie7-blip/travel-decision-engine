// A shared trip link that follows the owner's changes.
//
// Run: npm run test:latest-revision

import { latestRevision, nextKey, recordRevision } from "./latestRevision";
import { jobKey } from "./jobs";
import { check, finish, heading, section } from "./testutil";

heading("a shared link follows the owner's revisions");

function fakeRedis() {
  const store = new Map<string, unknown>();
  return {
    store,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    },
    get: async <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
  };
}

const job = (id: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    status: "done",
    brief: { destinations: ["Rome"], start_date: "2027-01-15", end_date: "2027-01-17" },
    result: { days: [] },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

async function main() {
  section("the owner's push back moves the link");
  {
    const r = fakeRedis();
    r.store.set(jobKey("a"), job("a", { ownerEmail: "me@example.com" }));
    r.store.set(jobKey("b"), job("b", { ownerEmail: "Me@Example.com", replaces: "a" }));
    check("recorded", await recordRevision(r as never, { id: "a", ownerEmail: "me@example.com" }, { id: "b", ownerEmail: "Me@Example.com", ttlSeconds: 60 }));
    check("the old link opens the new version", (await latestRevision(r as never, "a")) === "b");

    r.store.set(jobKey("c"), job("c", { ownerEmail: "me@example.com", replaces: "b" }));
    await recordRevision(r as never, { id: "b", ownerEmail: "me@example.com" }, { id: "c", ownerEmail: "me@example.com", ttlSeconds: 60 });
    check("through every revision since", (await latestRevision(r as never, "a")) === "c");
    check("and the newest link is itself", (await latestRevision(r as never, "c")) === "c");
  }

  section("a friend's push back does not");
  {
    const r = fakeRedis();
    r.store.set(jobKey("a"), job("a", { ownerEmail: "me@example.com" }));
    const recorded = await recordRevision(r as never, { id: "a", ownerEmail: "me@example.com" }, { id: "f", ownerEmail: "friend@example.com", ttlSeconds: 60 });
    check("nothing recorded", !recorded && !r.store.has(nextKey("a")));
    check("signed out, nothing recorded", !(await recordRevision(r as never, { id: "a", ownerEmail: "me@example.com" }, { id: "g", ttlSeconds: 60 })));
    check("a trip made signed out has no owner to follow", !(await recordRevision(r as never, { id: "x" }, { id: "y", ttlSeconds: 60 })));
  }

  section("only to a version that exists");
  {
    const r = fakeRedis();
    r.store.set(jobKey("a"), job("a", { ownerEmail: "me@example.com" }));
    r.store.set(jobKey("b"), job("b", { ownerEmail: "me@example.com", status: "running" }));
    r.store.set(nextKey("a"), "b");
    check("not to one still being planned", (await latestRevision(r as never, "a")) === "a");
    r.store.set(jobKey("b"), job("b", { ownerEmail: "me@example.com", status: "error" }));
    check("not to one that failed", (await latestRevision(r as never, "a")) === "a");
    r.store.delete(jobKey("b"));
    check("not to one that has expired", (await latestRevision(r as never, "a")) === "a");
    r.store.set(jobKey("b"), job("b", { ownerEmail: "someone@else.com" }));
    check("not to someone else's, even with a pointer", (await latestRevision(r as never, "a")) === "a");
  }

  section("a pointer loop cannot hang the page");
  {
    const r = fakeRedis();
    r.store.set(jobKey("a"), job("a", { ownerEmail: "me@example.com" }));
    r.store.set(jobKey("b"), job("b", { ownerEmail: "me@example.com" }));
    r.store.set(nextKey("a"), "b");
    r.store.set(nextKey("b"), "a");
    const answer = await latestRevision(r as never, "a");
    check("it stops", answer === "a" || answer === "b");
  }

  finish();
}

main();
