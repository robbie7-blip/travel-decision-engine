// How often the trip page asks whether the trip is ready.
//
// 400ms is right for a visible tab and is deliberately not changed here:
// these polls are not an "is it done yet" ping, they are the content feed
// for components/TripBuilding, whose own comment reads "Nothing here is a
// fake progress bar. Every row is real content." Slowing them down would
// make the one genuinely engaging minute in this product stutter.
//
// None of that applies to a tab nobody is looking at, which is where a
// fair share of a sixty-second generation is actually spent. At 400ms a
// hidden tab makes 150 round trips a minute to drive an interface that is
// not on screen.
//
// The three things that have to hold, and the third is the one that would
// rot silently: a hidden tab backs off, coming BACK to the tab resumes
// immediately rather than after up to two seconds of staleness, and the
// visibility listener is removed either way - a five-minute poll that
// leaked one per iteration would accumulate hundreds.
//
// Run: npm run test:poll-pacing

import { HIDDEN_POLL_INTERVAL_MS, POLL_INTERVAL_MS, waitBeforeNextPoll } from "./api";
import { check, finish, heading, section } from "./testutil";

heading("how often the trip page polls");

// Wrapped in main() because tsx compiles these suites to CJS, where
// top-level await is not available - the same arrangement
// lib/session.test.ts uses.
async function main() {

  /** A document just real enough: a visibility state and a listener list. */
  function installDocument(state: "visible" | "hidden") {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: state,
      addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
    };
    (globalThis as { document?: unknown }).document = doc;
    return {
      listeners,
      /** Becomes visible and fires the event, as a browser would. */
      reveal() {
        doc.visibilityState = "visible";
        for (const fn of [...listeners]) fn();
      },
      /** Back to the background. A browser fires on hide too, but
       * nothing here listens for that. */
      hide() {
        doc.visibilityState = "hidden";
      },
    };
  }

  function clearDocument() {
    delete (globalThis as { document?: unknown }).document;
  }

  async function timed(fn: () => Promise<unknown>): Promise<number> {
    const start = Date.now();
    await fn();
    return Date.now() - start;
  }

  /** Generous windows: this asserts which of two very different intervals
   * was used, not the accuracy of setTimeout on a busy CI runner. */
  const near = (actual: number, target: number) => actual >= target - 60 && actual < target + 400;

  section("a visible tab keeps full speed");

  {
    installDocument("visible");
    const ms = await timed(waitBeforeNextPoll);
    check(`waits about ${POLL_INTERVAL_MS}ms`, near(ms, POLL_INTERVAL_MS), `${ms}ms`);
    clearDocument();
  }

  section("a hidden tab backs off");

  {
    const doc = installDocument("hidden");
    const ms = await timed(waitBeforeNextPoll);
    check(`waits about ${HIDDEN_POLL_INTERVAL_MS}ms`, near(ms, HIDDEN_POLL_INTERVAL_MS), `${ms}ms`);
    check("which is a real reduction, not a rounding difference", HIDDEN_POLL_INTERVAL_MS >= POLL_INTERVAL_MS * 4);
    check("and it left no listener behind", doc.listeners.size === 0, String(doc.listeners.size));
    clearDocument();
  }

  section("coming back to the tab resumes at once");

  {
    const doc = installDocument("hidden");
    const ms = await timed(async () => {
      const waiting = waitBeforeNextPoll();
      // Looked at again, well before the backed-off interval would elapse.
      setTimeout(() => doc.reveal(), 150);
      await waiting;
    });
    check(
      "returns on the visibility change, not on the timer",
      ms < HIDDEN_POLL_INTERVAL_MS - 400,
      `${ms}ms, which is not clearly before ${HIDDEN_POLL_INTERVAL_MS}ms`
    );
    check("and still left no listener behind", doc.listeners.size === 0, String(doc.listeners.size));
    clearDocument();
  }

  section("nothing to ask");

  {
    // Server-side, or any environment with no document: must not throw, and
    // must not wait for a visibility change that can never come.
    clearDocument();
    let threw = false;
    const ms = await timed(async () => {
      try {
        await waitBeforeNextPoll();
      } catch {
        threw = true;
      }
    });
    check("no document does not throw", threw === false);
    check("and falls back to the full-speed interval", near(ms, POLL_INTERVAL_MS), `${ms}ms`);
  }

  section("repeated waits do not accumulate listeners");

  {
    const doc = installDocument("hidden");
    // Ten hidden gaps in a row, the shape a backgrounded five-minute poll
    // actually takes.
    for (let i = 0; i < 10; i++) {
      const waiting = waitBeforeNextPoll();
      doc.reveal();
      await waiting;
      doc.hide();
    }
    check("ten iterations leave zero listeners", doc.listeners.size === 0, String(doc.listeners.size));
    clearDocument();
  }


  finish();
}

void main();
