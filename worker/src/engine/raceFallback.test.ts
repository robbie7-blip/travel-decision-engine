// Tests the bounded wait that took the accommodation lookup off the
// critical path.
//
// This one guards a change to the critical path of every generation, so the
// edge cases matter more than the happy one. Two of them are the difference
// between a slow trip and no trip at all:
//
//   - a REJECTED fallback must never win the race. The frame failing is
//     already a recoverable event (the live lookup covers it); if that
//     rejection also made us abandon the lookup, one recoverable failure
//     would become a job with neither figure.
//   - an abandoned lookup must have its rejection observed. Node terminates
//     the process on an unhandled rejection and this worker runs four jobs
//     at once - the exact hazard that killed the worker once already and
//     orphaned four travellers' trips.
//
// Time is injected, so this suite is instant and deterministic rather than
// sleeping through real grace periods.
//
// Run: npm run test:race-fallback

import { waitForLiveOrFallback } from "./raceFallback";
import { check, finish, heading, section } from "../testutil";

heading("bounded wait for an optional value");

/** A promise plus its settle handles, so a test drives the ordering. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every already-queued microtask run. */
const settle = () => new Promise((r) => setImmediate(r));

async function main() {
  section("the live value wins when it arrives in time");

  {
    const live = deferred<string[]>();
    const frame = deferred<void>();
    const p = waitForLiveOrFallback(live.promise, frame.promise, 1000, async () => {});
    live.resolve(["real price"]);
    const got = await p;
    check("a lookup that answers first is used", JSON.stringify(got) === '["real price"]', JSON.stringify(got));
  }

  {
    // The frame is ready, but the lookup lands inside the grace period.
    // Waiting those few seconds is the whole reason for a grace period.
    const live = deferred<string[]>();
    const frame = deferred<void>();
    let slept = 0;
    const p = waitForLiveOrFallback(live.promise, frame.promise, 3000, async (ms) => {
      slept = ms;
      // The lookup answers while we are sleeping out the grace period.
      live.resolve(["just in time"]);
    });
    frame.resolve();
    const got = await p;
    check("a lookup that lands within the grace period is still used", JSON.stringify(got) === '["just in time"]', JSON.stringify(got));
    check("and the grace period was the configured one", slept === 3000, String(slept));
  }

  section("giving up once the fallback is ready");

  {
    // The 58.5s run: the frame is in hand and the lookup is still going.
    const live = deferred<string[]>();
    const frame = deferred<void>();
    const p = waitForLiveOrFallback(live.promise, frame.promise, 0, async () => {});
    frame.resolve();
    const got = await p;
    check("null once the fallback is ready and the grace has passed", got === null, JSON.stringify(got));
  }

  {
    // Abandoning must not disturb the lookup, which still runs and still
    // populates the accommodation cache for the next generation.
    const live = deferred<string[]>();
    const frame = deferred<void>();
    const p = waitForLiveOrFallback(live.promise, frame.promise, 0, async () => {});
    frame.resolve();
    check("gave up", (await p) === null);
    let landedAfter = false;
    live.promise.then(() => { landedAfter = true; });
    live.resolve(["late"]);
    await settle();
    check("the abandoned lookup still settles on its own", landedAfter);
  }

  section("a failed fallback must never win");

  {
    // The frame call failed - so there IS no fallback, and abandoning the
    // lookup as well would leave the job with no accommodation figure at
    // all. It has to keep waiting.
    const live = deferred<string[]>();
    const frame = deferred<void>();
    const p = waitForLiveOrFallback(live.promise, frame.promise, 0, async () => {});
    frame.reject(new Error("frame call failed"));
    await settle();
    let resolved = false;
    p.then(() => { resolved = true; });
    await settle();
    check("still waiting after the fallback rejected", resolved === false);

    live.resolve(["arrived eventually"]);
    const got = await p;
    check("and the lookup is used when it finally lands", JSON.stringify(got) === '["arrived eventually"]', JSON.stringify(got));
  }

  section("a failed lookup still fails the way it used to");

  {
    // Not this function's job to decide a lookup failure is survivable -
    // the rejection propagates exactly as the unconditional await did.
    const live = deferred<string[]>();
    const frame = deferred<void>();
    const p = waitForLiveOrFallback(live.promise, frame.promise, 0, async () => {});
    live.reject(new Error("lookup exploded"));
    let message = "";
    try {
      await p;
    } catch (e) {
      message = (e as Error).message;
    }
    check("the rejection propagates", message === "lookup exploded", message);
  }

  {
    // The dangerous ordering: we give up, and only THEN does the abandoned
    // lookup reject. Nothing is awaiting it any more, and Node exits the
    // process on an unhandled rejection - taking the other three concurrent
    // jobs with it.
    //
    // Currently satisfied by Promise.race, which attaches handlers to both
    // promises when it is called and so observes the loser forever. That is
    // an implementation detail of the race, not an explicit guard: an
    // earlier version of this module "protected" it with a redundant
    // wrapped.catch() that changed no test when deleted. This assertion
    // stays because the REQUIREMENT is real - a refactor that stopped
    // racing on the live promise would reintroduce the crash.
    const live = deferred<string[]>();
    const frame = deferred<void>();
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    process.on("unhandledRejection", onUnhandled);

    const p = waitForLiveOrFallback(live.promise, frame.promise, 0, async () => {});
    frame.resolve();
    check("gave up first", (await p) === null);
    live.reject(new Error("rejected after being abandoned"));
    await settle();
    await settle();
    process.off("unhandledRejection", onUnhandled);
    check("an abandoned lookup's rejection does not go unhandled", unhandled === null, String(unhandled));
  }

  section("a grace period of zero");

  {
    const live = deferred<string[]>();
    const frame = deferred<void>();
    let sleepCalls = 0;
    const p = waitForLiveOrFallback(live.promise, frame.promise, 0, async () => { sleepCalls++; });
    frame.resolve();
    check("gives up immediately", (await p) === null);
    check("and does not sleep at all", sleepCalls === 0, String(sleepCalls));
  }

  finish();
}

main();
