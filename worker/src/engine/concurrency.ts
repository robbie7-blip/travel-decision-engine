// Bounded parallelism, in one place.
//
// There were two copies of this: one in index.ts that collects results (the
// day calls) and one in venueVerification.ts that discards them (the Places
// lookups). They were the same function with R pinned to void, and keeping
// them apart meant a fix to one silently left the other alone - which is
// exactly what happened with the early exit below.
//
// Run: npm run test:concurrency

/** Runs `fn` over `items`, at most `limit` at a time, preserving order.
 *
 * Stops STARTING new work as soon as one item has failed. Promise.all
 * rejects on the first rejection, but on its own it does not stop the other
 * workers: each sits in its own loop and carries on pulling the next index
 * and issuing the next call, producing output the caller has already decided
 * to throw away.
 *
 * For the day calls that is a whole extra wave on a trip longer than
 * MAX_PARALLEL_DAYS (16) - up to fourteen more model calls at the 30-day cap,
 * commissioned after the generation had already failed and fallen back to the
 * single-call path. For the Places lookups it is more billed venue lookups
 * for a verification pass whose result is being discarded.
 *
 * Deliberately does NOT abort work already in flight. Threading an
 * AbortSignal through every call would add machinery to the critical path of
 * every generation to save a little on a rare failure, which is the wrong
 * trade. Nor is the spend of those in-flight calls lost: processJob's
 * `costUsd` is a closure that late `onUsage` callbacks still add to, and
 * recordSpend reads it at the END of the job rather than snapshotting it
 * earlier, so what they spend still counts against the daily budget.
 *
 * The FIRST rejection is the one that propagates, unchanged from before -
 * callers that map an error to a specific message still see the same one. */
export async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (failed) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch (e) {
        // Set before rethrowing, so siblings see it on their next turn
        // round the loop rather than after starting one more call.
        failed = true;
        throw e;
      }
    }
  });

  await Promise.all(workers);
  return results;
}
