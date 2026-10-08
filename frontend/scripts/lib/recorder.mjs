// Driving a headless browser frame by frame, for the scripts that film
// the product.
//
// Extracted from scripts/makeDartClip.mjs when a second script needed the
// same thing (makePromoVideo.mjs). Copying it would have been faster and
// wrong, for the reason the header of devServer.mjs gives about its own
// extraction: what is below is not boilerplate, it is the residue of
// specific failures, and two copies means the next failure gets fixed in
// one of them.
//
// WHY THE CLOCK IS DRIVEN RATHER THAN WATCHED. There is no GPU in a
// container or on a CI runner, so a WebGL page renders in software at
// something near a frame a second. A screencast of that is a slideshow,
// however it is resampled - the first attempt at the dart clip got eight
// frames in five and a half seconds. CDP virtual time advances
// performance.now, Date.now, timers and requestAnimationFrame by an exact
// budget and then stops, so a frame can be captured at precisely 1/fps of
// animation no matter how long the render took.
//
// AND THE ONE THING VIRTUAL TIME BREAKS. It does NOT advance the
// timestamp handed to a requestAnimationFrame callback; that still comes
// from the compositor, which is not being advanced. Nothing errors, so
// anything measuring elapsed time as `now - startedAt` where `now` is the
// callback argument and `startedAt` is performance.now simply freezes,
// while everything around it - tweens on their own clock, setTimeout -
// keeps moving. The dart clip looked entirely plausible that way: a
// globe, a camera flight, a country named, and no dart. The shim below
// hands callbacks performance.now instead. In a real browser both are the
// same timebase and it changes nothing, which is the point: the
// divergence is something this recorder introduces, so this recorder is
// what pays for it.
//
// A PAGE PER SHOT, not one page re-navigated. Virtual time is a property
// of a target, and there is no command for "give this page its real clock
// back" - "advance" with no budget runs it as fast as it can, which is
// not the same thing and not something a page being loaded should be
// doing. A fresh target starts with a fresh, unpaused clock, which is
// exactly what loading the next shot needs.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Software WebGL, by name. Without these a page that needs a canvas
 * renders without one, and a recording of that is a recording of the
 * fallback. */
export const SWIFTSHADER_ARGS = ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"];

/** What every recorded page gets before it runs.
 *
 * ONE: requestAnimationFrame callbacks are handed the clock the rest of
 * the page is using. See the note at the top - without this a recording
 * silently loses anything timed off the callback argument.
 *
 * TWO: no text caret, anywhere. This one took three wrong theories to
 * find. A shot that focuses a text input - which the form shot does,
 * because a form being filled in is the point - hung
 * Page.captureScreenshot for ever. Not the typing, not the scrolling,
 * not a static page: those all capture in about 120ms. It is the caret.
 * A focused input blinks, the blink wants frames, the clock is paused so
 * no frame comes, and the capture waits for one that never will. The
 * measurement was unambiguous: no focus 141ms, focus never returns,
 * focus with the caret made transparent 165ms.
 *
 * Hiding it costs nothing a viewer would notice - letters appearing one
 * at a time already reads as typing - and it removes the whole hazard
 * rather than leaving each shot to remember it.
 */
const PAGE_SETUP = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf(() => callback(performance.now()));

  const hideCaret = () => {
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { caret-color: transparent !important; }";
    (document.head || document.documentElement).appendChild(style);
  };
  document.documentElement ? hideCaret() : document.addEventListener("DOMContentLoaded", hideCaret);
})()`;

/**
 * Opens a headless browser whose pages' clocks this process controls.
 *
 * Throws rather than returning a failure: every caller's only sensible
 * response to "no browser" is to stop, and a recording that quietly
 * produced nothing is worse than one that said why.
 */
export async function openRecorder({ chrome, args = [] }) {
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      // One less process holding the pipes the endpoint is read from.
      "--no-zygote",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "recorder-"))}`,
      "--hide-scrollbars",
      ...args,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  // Port 0 means the browser picks one and prints it on stderr. Asking
  // for a fixed port is how two of these collide on a busy machine.
  let output = "";
  const wsUrl = await new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(null), 30_000);
    browser.stderr.on("data", (chunk) => {
      output += chunk;
      const match = /ws:\/\/[^\s]+/.exec(output);
      if (match) {
        clearTimeout(deadline);
        resolve(match[0]);
      }
    });
    browser.on("exit", () => {
      clearTimeout(deadline);
      resolve(null);
    });
  });

  /** Kill it AND let go of its pipes.
   *
   * Killing alone is not enough: Chromium's children inherit the stderr
   * pipe above, and node's event loop stays alive while anything holds
   * the far end. checkDartFallback.mjs hung forever on exactly this,
   * after printing the right answer. */
  let closed = false;
  const closeBrowser = () => {
    if (closed) return;
    closed = true;
    try {
      browser.kill();
      browser.stdout?.destroy();
      browser.stderr?.destroy();
      browser.unref();
    } catch {
      /* already gone */
    }
  };

  if (!wsUrl) {
    closeBrowser();
    throw new Error(`the browser never reported a debugging endpoint. Its output:\n${output.trim()}`);
  }

  const socket = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("could not connect to the browser")), { once: true });
    });
  } catch (error) {
    closeBrowser();
    throw error;
  }

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      return;
    }
    if (message.method) for (const listener of listeners) listener(message);
  });

  /** One sender for everything. `session` is omitted for the calls that
   * set a session up and carried for everything after.
   *
   * EVERY CALL CARRIES A DEADLINE, and that is not belt-and-braces. Two
   * recordings have now hung indefinitely on a single call that never
   * came back - once on a virtual-time budget the page could not spend,
   * once somewhere in a shot that took a long time to narrow down
   * because the failure looks identical from outside: a process at 0%
   * CPU, no output, no error, indistinguishable from slow work. A call
   * that stops and names itself turns that into one line of output. The
   * limit is generous because one frame of software WebGL genuinely
   * takes four seconds. */
  const CALL_TIMEOUT_MS = 120_000;
  const call = (method, params = {}, session) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const deadline = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} never came back (waited ${CALL_TIMEOUT_MS / 1000}s)`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(deadline);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(deadline);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });

  return {
    /**
     * A fresh page with a fresh clock, sized for the shot.
     *
     * `stepMs` is one frame of animation: what `advance()` moves the page
     * by when called without an argument.
     */
    async newPage({ width, height, deviceScaleFactor = 1, stepMs, shootTimeoutMs = 4000 }) {
      const { targetId } = await call("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params) => call(method, params, sessionId);

      async function evaluate(expression) {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result.value;
      }

      await send("Page.enable", {});
      await send("Runtime.enable", {});
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: false });
      // Before any navigation, or the page it is meant to fix has already run.
      await send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_SETUP });

      /** Waits for the page to finish spending a virtual-time budget.
       *
       * WITH A DEADLINE, because the first version of this had none and
       * hung for thirty-eight minutes. The policy was
       * `pauseIfNetworkFetchesPending`, which is the obvious choice - do
       * not run the clock on while the page is still waiting for
       * something - and it is wrong for a recorder. The homepage asks
       * /api/demo-trip for the "see a real example" link, that route
       * wants Redis, and a machine filming the site has no reason to have
       * Redis credentials. One request that never settles, virtual time
       * paused for ever, no event, no error, and a script sitting at 0%
       * CPU looking exactly like a script doing slow work.
       *
       * So the policy is `advance`, which spends the budget whatever the
       * network is doing, and this throws if the event still does not
       * come. A recorder that stops and says why beats one that waits.
       */
      /** The last frame that really came back, and how often it stood in
       * for one that did not. See `shoot`. */
      let lastShot = null;
      let reused = 0;

      const budgetExpired = () =>
        new Promise((resolve, reject) => {
          const deadline = setTimeout(() => {
            listeners.delete(listener);
            reject(
              new Error(
                "the page never finished a frame of virtual time (waited 60s). " +
                  "Something on it is blocking the clock rather than taking a long time to draw."
              )
            );
          }, 60_000);
          const listener = (message) => {
            if (message.method !== "Emulation.virtualTimeBudgetExpired") return;
            clearTimeout(deadline);
            listeners.delete(listener);
            resolve();
          };
          listeners.add(listener);
        });

      return {
        send,
        evaluate,

        /** Load a URL and let it settle, in REAL time.
         *
         * Deliberately before the clock is paused: a page still fetching,
         * hydrating and laying itself out needs wall-clock patience, and
         * this wait is what gives an effect like the WebGL probe the
         * chance to decide anything at all. */
        async load(url, settleMs = 2500) {
          await send("Page.navigate", { url });
          await evaluate(`new Promise((done) => {
            const settle = () => setTimeout(() => done(true), ${settleMs});
            document.readyState === "complete" ? settle() : window.addEventListener("load", settle);
          })`);
        },

        /** Take the clock away from the page. */
        async pauseClock() {
          await send("Emulation.setVirtualTimePolicy", { policy: "pause" });
        },

        /** Move the page on by one frame of animation, then stop it again.
         *
         * `advance` rather than `pauseIfNetworkFetchesPending`: see
         * budgetExpired above for the request that never came back and
         * the thirty-eight minutes it cost. A recording wants the clock
         * to move on schedule; whether a fetch is outstanding is the
         * page's problem, not the frame rate's. */
        async advance(ms = stepMs) {
          const expired = budgetExpired();
          await send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: ms });
          await expired;
        },

        /** What is on the page now, as a JPEG.
         *
         * `clip` is in CSS pixels. Cropping here rather than afterwards
         * means the pixels outside it are never encoded, read back or
         * thrown away.
         *
         * fromSurface: false WAS TRIED HERE AND TAKEN BACK OUT. The idea
         * was sound - the default waits on the compositor's surface, and
         * capturing from the renderer does not - but it silently ignores
         * `clip` and returns the whole viewport. The dart clip came out
         * 720x464 instead of 720x355, which is precisely the full
         * 1180x760 viewport's aspect ratio: it had been filming the
         * entire page and scaling it down, globe, button, explanatory
         * paragraph and all. Nothing failed; the numbers in the output
         * line were simply a different shape, which is the only reason it
         * was noticed.
         *
         * It was not what fixed the stall anyway. The repeat-the-last-
         * frame fallback below is, and it works whether the capture comes
         * from the surface or the renderer.
         */
        async shoot(clip) {
          const capture = send("Page.captureScreenshot", {
            format: "jpeg",
            quality: 95,
            ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
          }).then((shot) => Buffer.from(shot.data, "base64"));

          const stalled = Symbol("stalled");
          const raced = await Promise.race([
            capture,
            new Promise((resolve) => setTimeout(() => resolve(stalled), shootTimeoutMs)),
          ]);

          if (raced !== stalled) {
            lastShot = raced;
            return raced;
          }

          // A capture that never returns means the page has not painted,
          // and a page that has not painted still looks exactly like the
          // last frame of it. So that frame IS this frame.
          //
          // The first one cannot be waved through, though: with nothing
          // to repeat, a stall there is a real failure and should say so.
          capture.catch(() => {});
          if (!lastShot) {
            throw new Error(
              `the first frame never came back (waited ${shootTimeoutMs / 1000}s), so there is ` +
                `nothing to film and nothing to repeat`
            );
          }
          reused++;
          return lastShot;
        },

        /** How many frames were repeats of the one before, because the
         * page had not painted. Worth printing: a shot that is mostly
         * reused frames is a shot of something that was not moving. */
        get reusedFrames() {
          return reused;
        },

        async close() {
          try {
            await call("Target.closeTarget", { targetId });
          } catch {
            /* already gone */
          }
        },
      };
    },

    close() {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      closeBrowser();
    },
  };
}
