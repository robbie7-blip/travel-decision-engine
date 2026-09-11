// Waiting for something optional, without letting it own the critical path.
//
// The live accommodation lookup is an OPTIMISATION. It buys a real nightly
// price and a named hotel; when it comes back empty the trip frame's own
// estimate is used instead, and that fallback path is fully built and
// exercised. Despite that, phase 2 awaited the lookup unconditionally - so
// on the first measured 58.5s generation the lookup (16.5s, then a retry
// that also came back empty, 29.2s total) WAS the critical path, and the
// retry spent those extra seconds to end up exactly where the fallback
// would have been anyway.
//
// The retry's own justification says as much: "these run CONCURRENTLY WITH
// PHASE 1 - measured at 16.5s of prefetch against 24.0s of phase 1, so
// there is real slack before a retry costs the generation anything at all."
// True, and conditional on the retry SUCCEEDING and on phase 1 staying
// slower. Neither held, and nothing capped the downside.
//
// So: wait for the live answer, but stop waiting once the fallback is ready
// and a short grace period has passed. Past that point every further second
// is spent on a value we already have a substitute for.
//
// Run: npm run test:race-fallback

/** Never settles. Used to take a loser permanently out of a race. */
const NEVER: Promise<never> = new Promise(() => {});

/** Sentinel for "stopped waiting". A unique object rather than a symbol
 * purely because `unique symbol` and an async return type fight each other;
 * identity comparison is what matters and an object gives that too. */
const GIVE_UP: { readonly giveUp: true } = { giveUp: true };

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The live value if it arrives in time, or null meaning "use the fallback".
 *
 * `fallbackReady` resolving is the signal that waiting has started costing
 * something: until then the live lookup is running alongside work that
 * hasn't finished either, and waiting for it is free.
 *
 * Three behaviours worth stating, because each one is a way this could go
 * wrong quietly:
 *
 *  - If `fallbackReady` REJECTS there is no fallback, so it must never win.
 *    A frame call that failed would otherwise make us abandon the live
 *    lookup too, leaving the job with neither - turning one recoverable
 *    failure into a failed generation. On rejection this waits for `live`
 *    however long it takes, which is exactly what the old code did.
 *
 *  - If `live` rejects, that rejection propagates, unchanged from before.
 *    This is not the place to decide a lookup failure is survivable.
 *
 *  - If we give up, `live` is still running. Its rejection is marked
 *    observed so an abandoned lookup cannot terminate the process (Node
 *    exits on an unhandled rejection, and this worker runs four jobs at
 *    once - see the framePromise.catch note in index.ts for the same
 *    hazard found the hard way). Its eventual success is not wasted either:
 *    the prefetch writes what it found to the accommodation cache, so the
 *    next generation for that city starts with a real price. */
export async function waitForLiveOrFallback<T>(
  live: Promise<T>,
  fallbackReady: Promise<unknown>,
  graceMs: number,
  sleep: Sleep = defaultSleep
): Promise<T | null> {
  // Wrapped so the winner can be told apart from the give-up sentinel by
  // identity rather than by inspecting the value.
  //
  // No extra .catch is needed here to keep an abandoned lookup's rejection
  // observed: Promise.race attaches handlers to BOTH promises the moment it
  // is called, so `wrapped` - and `live` through it - is observed for the
  // rest of its life whether or not it wins. An explicit
  // `wrapped.catch(() => {})` was written here first and proved dead when
  // removing it changed no test, which is the only reason the claim above
  // is stated rather than defended by a line of code.
  const wrapped = live.then((value) => ({ value }));

  const giveUp: Promise<typeof GIVE_UP> = fallbackReady.then(
    async () => {
      if (graceMs > 0) await sleep(graceMs);
      return GIVE_UP;
    },
    // No fallback - take this side out of the race entirely.
    (): Promise<typeof GIVE_UP> => NEVER
  );

  const winner = await Promise.race([wrapped, giveUp]);
  if (winner === GIVE_UP) return null;
  // Narrowed by the identity check above; `winner` is the wrapped value.
  return (winner as { value: T }).value;
}
