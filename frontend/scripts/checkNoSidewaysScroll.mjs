// Nothing on a phone is read by swiping left and right.
//
// WHY THIS EXISTS. Ask a Local answered a question about a hotel and the
// answer arrived with a booking reference in it. The reference is one word
// with nowhere to break, so it kept its full width, pushed the answer past
// the thread, and - because .qa-thread sets overflow-y, which makes a box
// horizontally scrollable as a side effect - the conversation became a
// 616px canvas inside a 276px window on a 390px phone. Every line of the
// answer was there. You had to drag it sideways to read the end of each
// one.
//
// Nothing caught it. The CSS was right in the only way that is easy to
// check (.qa-answer already had min-width: 0, and the comment above it
// says why), and a page sweep with an EMPTY thread passes: at the moment
// the page loads there is no answer in it. The fault only exists once
// there is content, and only for content of a particular shape.
//
// So this does two things:
//
// 1. Sweeps every page a visitor can reach at phone width and fails if
//    anything scrolls sideways.
// 2. Drives Ask a Local with an answer built to break a layout - a long
//    compound word, an address, a reference code - and sweeps again. The
//    model is never called: the route is stubbed in the browser, so this
//    costs nothing and always sends the same hostile text.
//
// WHAT COUNTS AS A FAULT. Only a box that can ACTUALLY be scrolled
// sideways: computed overflow-x of auto or scroll, with more content than
// fits. A box with overflow visible whose content spills is not reported
// here, because the spill lands on the document and the document is
// checked too - reporting both would name four elements for one bug. A box
// with overflow hidden is not reported either: clipped text is a different
// complaint, and this check is about the swiping.
//
// Run: npm run build && npm run check:no-sideways

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findChrome, startNextServer } from "./lib/devServer.mjs";
import { openRecorder, SWIFTSHADER_ARGS } from "./lib/recorder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");

/** iPhone 12/13/14/15 logical width - the same single width
 * checkTouchTargets measures at, for the same reason: it is the phone most
 * of this gets read on. */
const WIDTH = 390;
const HEIGHT = 844;

/** The pages checkTouchTargets and checkAccessibleNames drive, including
 * the deliberately missing route. */
const PAGES = [
  "/",
  "/ask",
  "/pricing",
  "/account",
  "/account/visited",
  "/destinations",
  "/destinations/rome",
  "/bg/destinations/rome",
  "/showcase",
  "/decide-for-me",
  "/why-decide",
  "/terms",
  "/privacy",
  "/cookies",
  "/compare",
  "/compare-stats",
  "/this-route-does-not-exist",
];

/** Rows that are MEANT to be swiped: a carousel of pills, a week of
 * weather. A horizontal scroller has to say so, in the markup, where the
 * next person to read it will see it - which is the whole point of the
 * allowlist being selectors rather than a tolerance. */
const DELIBERATE = [".scroll-row-mobile", "[data-sideways-ok]"];

/** An answer built out of the three shapes that actually break a text
 * column, all of which a real answer can contain:
 *
 * - a long compound word (no break opportunity at all)
 * - an email address (Chromium will not break one)
 * - a booking reference in caps
 *
 * A bare URL is deliberately in here too, as the control: Chromium already
 * breaks those at the slashes, which is exactly why the real bug went
 * unnoticed for as long as it did. */
const HOSTILE_ANSWER = [
  "Two things to sort out before you fly.",
  "",
  "The transfer is booked through the Donaudampfschifffahrtsgesellschaftskapitaensmuetze",
  "desk in the arrivals hall, which is a mouthful but it is what the sign says.",
  "Write to reservations.frontdesk.keramas@desa-swan-villas-and-spa-bali.co.id and",
  "quote DSV-2026-11-06-HONEYMOON-AIRPORT-TRANSFER-REQUEST-000198, or use",
  "https://www.example-booking-site.com/property/desa-swan-villas-and-spa-keramas-bali?checkin=2026-11-06",
  "if you would rather do it yourself.",
].join("\n");

/** And a question with the same problem in it. The traveler's own words
 * are rendered verbatim on purpose - nothing shortens a reference they
 * pasted out of a confirmation email - so the bubble has to cope. */
const HOSTILE_QUESTION =
  "Booked it already, ref DSV-2026-11-06-HONEYMOON-AIRPORT-TRANSFER-REQUEST-000198 - is the transfer included?";

const PROBE = `((deliberate) => {
  const doc = document.documentElement;
  const found = [];
  const name = (el) => el.tagName.toLowerCase() +
    ((el.className || "").toString().trim().split(/\\s+/).filter(Boolean)
      .slice(0, 2).map((c) => "." + c).join(""));

  if (doc.scrollWidth - doc.clientWidth > 1) {
    found.push({ el: "the page itself", content: doc.scrollWidth, box: doc.clientWidth });
  }

  for (const el of document.querySelectorAll("*")) {
    if (el.clientWidth === 0) continue;
    if (el.scrollWidth - el.clientWidth <= 1) continue;
    const overflowX = getComputedStyle(el).overflowX;
    // Only a box that can genuinely be dragged sideways. See the note at
    // the top of the script.
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    if (deliberate.some((sel) => el.closest(sel))) continue;
    found.push({
      el: name(el),
      content: el.scrollWidth,
      box: el.clientWidth,
      text: (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 60),
    });
  }
  return JSON.stringify(found);
})(${JSON.stringify(DELIBERATE)})`;

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  fail([
    "No Chrome or Chromium binary found, and whether a box scrolls sideways is",
    "a question only a browser can answer: it comes from font metrics, flex",
    "sizing and where the words happen to break, all at once.",
    "",
    "Set CHROME_PATH to one, or install Chromium. It is NOT skipped when the",
    "browser is missing: a check that quietly passes when it did not run is",
    "worse than one that does not exist.",
  ]);
}

if (!existsSync(join(FRONTEND, ".next"))) {
  fail(["No .next directory, so there is nothing to serve.", "", "  npm run build && npm run check:no-sideways"]);
}

let stopServer = null;
let recorder = null;
process.on("exit", () => {
  try {
    recorder?.close();
  } catch {
    /* already gone */
  }
  stopServer?.();
});

const started = await startNextServer({ cwd: FRONTEND, probePath: "/" });
stopServer = started.stop;
if (!started.ok) {
  fail([
    `next start never answered on port ${started.port}, so nothing was checked.`,
    "",
    started.log.trim() || "(the server printed nothing)",
  ]);
}

const origin = `http://127.0.0.1:${started.port}`;
recorder = await openRecorder({ chrome, args: SWIFTSHADER_ARGS });

const problems = [];

function record(where, found) {
  for (const f of found) {
    problems.push(
      `${where}: <${f.el}> holds ${f.content}px of content in a ${f.box}px box` +
        (f.text ? `  "${f.text}"` : "")
    );
  }
}

async function newPhone() {
  return recorder.newPage({
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    stepMs: 40,
    shootTimeoutMs: 20_000,
  });
}

// 1. Every page, as it loads.
for (const path of PAGES) {
  const page = await newPhone();
  try {
    await page.load(`${origin}${path}`, 2200);
    record(path, JSON.parse(await page.evaluate(PROBE)));
  } catch (error) {
    problems.push(`${path}: could not be measured - ${String(error).slice(0, 120)}`);
  }
  await page.close();
}

// 2. Ask a Local, with a real conversation in it.
{
  const page = await newPhone();
  try {
    // Answer the question in the browser instead of calling the model.
    // Nothing about this check should cost money or depend on a key.
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/trip-questions*" }] });
    page.on("Fetch.requestPaused", async ({ requestId }) => {
      try {
        await page.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "content-type", value: "text/plain; charset=utf-8" }],
          body: Buffer.from(HOSTILE_ANSWER, "utf8").toString("base64"),
        });
      } catch {
        /* page closed mid-flight */
      }
    });

    await page.load(`${origin}/ask`, 2500);

    // Typed, not assigned: React listens for the input event, and a bare
    // .value = assignment does not fire one, so the send button would
    // stay disabled and this check would pass having measured nothing.
    const typed = await page.evaluate(`(() => {
      const box = document.querySelector("textarea.trip-qa-input");
      if (!box) return "no composer on /ask";
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, ${JSON.stringify(HOSTILE_QUESTION)});
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()`);
    if (typed !== "ok") problems.push(`/ask: ${typed}`);

    // With the question still in the box: a pasted reference must not
    // push the send button off the side of the composer.
    record("/ask (question typed, not yet sent)", JSON.parse(await page.evaluate(PROBE)));

    const sent = await page.evaluate(`(() => {
      const send = document.querySelector(".qa-send");
      if (!send) return "no send button on /ask";
      if (send.disabled) return "send button still disabled - the draft never reached React";
      send.click();
      return "ok";
    })()`);
    if (sent !== "ok") problems.push(`/ask: ${sent}`);

    // The stub answers in one chunk, but the thread still has to render,
    // scroll itself to the bottom and settle.
    await page.evaluate(`new Promise((done) => setTimeout(() => done(1), 2500))`);

    const arrived = await page.evaluate(`(() => {
      const answer = document.querySelector(".qa-answer");
      return answer && answer.innerText.includes("Donaudampfschifffahrts") ? "ok" : "no answer rendered";
    })()`);
    if (arrived !== "ok") {
      // Without this the check is theatre: it would sweep an empty thread
      // and report that the bug it exists for is fixed.
      problems.push(`/ask: ${arrived} - the hostile answer never reached the thread, so nothing was measured`);
    }

    record("/ask (answer in the thread)", JSON.parse(await page.evaluate(PROBE)));

    // And the saved-conversations list, whose rows are titled with the
    // question that was asked. A title is a sentence and the panel scrolls
    // vertically, so it is the same trap as the thread one line up: the
    // row has to CLIP its title, not widen to hold it.
    const opened = await page.evaluate(`(async () => {
      const toggle = document.querySelector(".ask-history-toggle");
      if (!toggle) return "no saved-chats control after an answer arrived";
      toggle.click();
      await new Promise((done) => setTimeout(() => done(1), 400));
      return document.querySelector(".ask-history-row") ? "ok" : "the list opened with no rows in it";
    })()`);
    if (opened !== "ok") problems.push(`/ask: ${opened}`);
    record("/ask (saved conversations open)", JSON.parse(await page.evaluate(PROBE)));
  } catch (error) {
    problems.push(`/ask (conversation): could not be measured - ${String(error).slice(0, 160)}`);
  }
  await page.close();
}

recorder.close();
recorder = null;
stopServer?.();
stopServer = null;

if (problems.length > 0) {
  fail([
    `Something has to be swiped sideways to be read, at ${WIDTH}px.`,
    "",
    ...problems.map((p) => `  ${p}`),
    "",
    "For a box of text, this is almost always one word with nowhere to break",
    "in it - an email address, a booking reference, a long compound word. The",
    "fix is `overflow-wrap: anywhere` on the box that holds the text, NOT",
    "`overflow-x: hidden` on an ancestor, which hides the end of every line",
    "instead of wrapping it.",
    "",
    "`anywhere` rather than `break-word`: only `anywhere` counts towards the",
    "element's min-content width, so a flex item stops asking to be wider",
    "than its parent. app/globals.css .qa-answer has the pattern and a note.",
    "",
    "A row that is MEANT to be swiped - a carousel of pills, a week of",
    "weather - says so in the markup, and this check skips it:",
    ...DELIBERATE.map((sel) => `  ${sel}`),
  ]);
}

console.log(
  `Nothing needs swiping sideways at ${WIDTH}px (${PAGES.length} pages, plus Ask a Local with an answer in it).`
);
process.exit(0);
