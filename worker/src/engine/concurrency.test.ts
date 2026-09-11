// Tests bounded parallelism, and specifically that a failure stops more
// work being started.
//
// The old version let it carry on. Promise.all rejected on the first
// rejection, but each worker sat in its own loop and kept pulling the next
// index and issuing the next model call - for output the caller had already
// decided to discard, since a failed day call sends the whole generation
// down the single-call path. On a trip longer than MAX_PARALLEL_DAYS that is
// a second wave of day calls, up to fourteen of them at the 30-day cap,
// commissioned after the generation had already failed.
//
// Run: npm run test:concurrency

import { runWithLimit } from "./concurrency";
import { check, finish, heading, section } from "../testutil";

heading("bounded parallelism");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  section("the ordinary case");

  {
    const out = await runWithLimit([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    check("results come back in INPUT order, not completion order", JSON.stringify(out) === "[10,20,30,40,50]", JSON.stringify(out));
  }

  {
    // Deliberately inverted durations: the first item is the slowest, so a
    // version that pushed results as they completed would reorder them.
    const out = await runWithLimit([50, 30, 10], 3, async (ms) => {
      await delay(ms);
      return ms;
    });
    check("order survives out-of-order completion", JSON.stringify(out) === "[50,30,10]", JSON.stringify(out));
  }

  {
    let inFlight = 0;
    let peak = 0;
    await runWithLimit(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight--;
    });
    check("never exceeds the limit", peak <= 4, `peak ${peak}`);
    check("and actually uses it", peak === 4, `peak ${peak}`);
  }

  check("an empty list does nothing and returns nothing", JSON.stringify(await runWithLimit([], 4, async () => 1)) === "[]");

  {
    // Math.min(limit, items.length) means a limit above the item count is
    // fine; a limit of 0 would spawn no workers at all and hang forever,
    // which is why readPositiveInt guards the dial that feeds this.
    const out = await runWithLimit([1, 2], 99, async (n) => n);
    check("a limit above the item count is fine", JSON.stringify(out) === "[1,2]", JSON.stringify(out));
  }

  section("a failure stops more work being started");

  {
    // Twenty items, four at a time - so five waves. Item 0 fails
    // immediately. The old version ran all twenty; this must stop early.
    const started: number[] = [];
    let error = "";
    try {
      await runWithLimit(Array.from({ length: 20 }, (_, i) => i), 4, async (i) => {
        started.push(i);
        if (i === 0) throw new Error("day 0 failed");
        await delay(5);
        return i;
      });
    } catch (e) {
      error = (e as Error).message;
    }
    check("the failure still propagates", error === "day 0 failed", error);

    // THE WAIT IS THE POINT. Promise.all rejects the instant item 0 throws,
    // so reading `started` straight after the catch reads it before the
    // other three workers have come back from their delay and pulled
    // again - and the first version of this test did exactly that, then
    // passed against the unfixed code when the early exit was reverted.
    // Long enough here for several more waves to have been issued.
    await delay(80);

    // The first four are started before anyone can observe the failure -
    // they were already pulled. What must NOT happen is the remaining
    // sixteen being issued afterwards.
    check(
      "work stops well short of the full list",
      started.length < 20,
      `started ${started.length} of 20: ${JSON.stringify(started)}`
    );
    check(
      "no more than the first wave was started",
      started.length <= 4,
      `started ${started.length}: ${JSON.stringify(started)}`
    );
  }

  {
    // The first rejection is the one that surfaces, unchanged - callers map
    // specific errors to specific traveller-facing messages.
    let error = "";
    try {
      await runWithLimit([1, 2], 2, async (n) => {
        if (n === 1) throw new Error("first");
        await delay(20);
        throw new Error("second");
      });
    } catch (e) {
      error = (e as Error).message;
    }
    check("the FIRST rejection propagates, not a later one", error === "first", error);
  }

  {
    // Two workers failing must not produce an unhandled rejection: Promise.all
    // attaches handlers to every worker, so the losers are observed. Node
    // exits the process on an unhandled rejection and this worker runs four
    // jobs at once.
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    process.on("unhandledRejection", onUnhandled);
    try {
      await runWithLimit([1, 2, 3, 4], 4, async () => {
        throw new Error("all of them failed");
      });
    } catch {
      // expected
    }
    await delay(20);
    process.off("unhandledRejection", onUnhandled);
    check("several simultaneous failures go handled", unhandled === null, String(unhandled));
  }

  {
    // A success followed by a failure still returns the failure, and the
    // already-collected results are simply discarded by the caller.
    let error = "";
    const started: number[] = [];
    try {
      await runWithLimit([1, 2, 3, 4, 5, 6], 1, async (n) => {
        started.push(n);
        if (n === 3) throw new Error("third failed");
        return n;
      });
    } catch (e) {
      error = (e as Error).message;
    }
    check("serial: stops at the failing item", error === "third failed" && JSON.stringify(started) === "[1,2,3]", `${error} ${JSON.stringify(started)}`);
  }

  finish();
}

main();
