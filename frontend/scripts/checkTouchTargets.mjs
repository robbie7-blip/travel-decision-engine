// No control under 44px on a phone, on any page.
//
// The rules that do this live in globals.css under (pointer: coarse) and
// they name their targets by class. That is the most breakable kind of
// coupling there is - a control shipped with its own padding and no class
// in that list is simply not covered, and nothing anywhere says so. A
// sweep found nine of them, on seven pages, long after each shipped:
//
//   326x15  the header context link back to the trip form, EVERY page
//   130x40  the logo link, on all nine hand-written headers
//   270x40  the email field on /pricing, 276x40 the one on /account
//   270x40  Subscribe, 199x35 "Email me a sign-in link", 59x35 Ask
//   266x29  the two example questions on /ask, 43x39 its photo button
//    59x15  "New cities" on /spin, that page's only other control
//   110x15  "All destinations" and 151x15 Wikipedia, on every city guide
//   171x17  the only link out of /compare's empty state
//
// Nothing looked broken. A 15px link is perfectly legible; it is just not
// hittable with a thumb, which is invisible on a laptop and is the whole
// experience on a phone.
//
// WHY THIS ONE NEEDS A BROWSER, unlike checkPrint.mjs next to it. A
// control's height comes from its font size, its line height, its padding,
// its flex context and any inline style the page sets, resolved together.
// There is no text-level version of this question: the previous static
// idea - "does every interactive element carry a covered class" - cannot
// see that a button inside .trip-form-grid is already covered by an
// ancestor rule, so it reports every one of them and proves nothing.
//
// It runs after `npm run build` in CI (see .github/workflows/checks.yml),
// where the runner already has Chrome, and it drives the real pages rather
// than a fixture so that a control added to a page is covered by being on
// that page at all.
//
// IT WAS PULLED OUT OF CI ONCE, on 2026-10-05, for hanging the job for six
// hours a run - GitHub's limit - on four runs out of five, which took CI
// red for sixteen days and stopped Railway deploying with it. Three
// separate unbounded things were found and fixed before the real one was:
// spawnSync draining a pipe Chromium's children still held, a fetch with
// no timeout in a loop that counted attempts rather than seconds, and a
// whole-run deadline that could not fire because it was only tested
// between iterations.
//
// NONE OF THOSE WAS THE CAUSE. The measuring always finished. The script
// printed the correct answer and then would not EXIT: `next start` is a
// grandchild of this process via npx, it outlived the signal sent to its
// launcher, and it held the inherited stdout and stderr pipes open, so the
// event loop never drained. Correct output, immortal process, six-hour
// job. See cleanup(), which now kills the whole process group, and the
// explicit process.exit at the end. It takes about 20 seconds.
//
// HOW THE MEASUREMENT WORKS, and why it is not just a narrow window.
// Headless Chromium enforces a 500px MINIMUM layout viewport and crops
// screenshots to the requested width, so `--window-size=390,900` lays the
// page out at 500px and hands back a 390px-wide crop of it. Every
// conclusion drawn that way is wrong. The page is therefore loaded in a
// same-origin iframe of an exact width, and measured through the DOM.
//
// Chromium also cannot be made to report (pointer: coarse) - not with
// --touch-events=enabled, not with any flag. So the body of every such
// block is lifted out of globals.css and injected into the page as plain
// CSS. EVERY block: the first attempt at this measurement took only the
// first of four and reported the gallery dots as 10x10 when a later block
// had already fixed them to 44x44.

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findChrome, startNextServer } from "./lib/devServer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");
const PUBLIC = join(FRONTEND, "public");

/** The minimum target, in CSS pixels. Apple HIG and WCAG 2.5.5 AAA. The
 * stylesheet's own comment cites the same number, so this is not a second
 * opinion about what the bar is. */
const MIN = 44;

/** 390 - iPhone 12/13/14/15, the most common phone width in the wild.
 *
 * It measured 360 as well, the commonest Android width, and that is now
 * gone: it doubled the number of browser launches for a second reading
 * that has never once disagreed with the first. Every control here is
 * sized by a min-height that does not consult the viewport, so a width
 * that finds nothing at 390 finds nothing at 360. Halving the launches is
 * worth more than a duplicate answer in a check that has to survive a CI
 * runner.
 *
 * Not at 320 either: the header is allowed to reflow below 346px (see
 * .header-account-group), and a reflow is a different question. */
const WIDTHS = [390];

/** A whole-run ceiling, separate from the per-launch one.
 *
 * Thirty launches that each take just under their own timeout is still
 * three quarters of an hour, and "slow enough to look broken" is a
 * failure this check has already inflicted on CI once. Past this it stops
 * and says so, which is a result; hanging is not. */
const MAX_TOTAL_MS = 8 * 60 * 1000;

/** The pages this drives, and what it deliberately leaves out.
 *
 * ROUTES_NOT_CHECKED is the anti-dormancy part: a new page under app/ that
 * is in neither list fails this script, rather than quietly not being
 * measured. That is the failure mode this repo has been bitten by twice
 * (see checkCiScripts.mjs), so a new route has to say which it is. */
const PAGES = [
  "/",
  "/ask",
  "/pricing",
  "/account",
  "/account/visited",
  "/destinations",
  "/showcase",
  "/decide-for-me",
  "/why-decide",
  "/terms",
  "/privacy",
  "/cookies",
  "/compare",
  "/compare-stats",
];

const ROUTES_NOT_CHECKED = {
  "/admin": "behind a password, and an internal tool nobody uses on a phone",
  "/admin/demo-trip": "see /admin",
  "/admin/feedback": "see /admin",
  "/admin/health": "see /admin",
  "/admin/showcase": "see /admin",
  "/admin/stats": "see /admin",
  "/admin/test-mode": "see /admin",
  // Needs a generated trip in Redis, which means a real model call and
  // real money. Its controls come from ItineraryResult and TripQA, and
  // TripQA's are measured on /ask, which renders the same component.
  "/trip/[jobId]": "needs a paid generation to render",
  // Measured, but through a real slug rather than the literal route - see
  // GUIDE_PAGE below.
  "/destinations/[slug]": "measured through a real slug instead",
};

/** One real city guide, resolved from the destination list rather than
 * hard-coded, so this keeps working when the list changes. */
function guidePage() {
  const dir = join(FRONTEND, "public", "destinations");
  const slug = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".jpg"))
        .map((f) => f.replace(/\.jpg$/, ""))
        .sort()[0]
    : null;
  return slug ? `/destinations/${slug}` : null;
}

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------- chromium

// ------------------------------------------------------------- coarse rules

/** The body of every @media (pointer: coarse) block in globals.css.
 *
 * Brace-matched rather than regexed, because the blocks contain nested
 * rules. ALL of them - taking only the first is a mistake already made
 * once here, and it reported controls as undersized that a later block
 * had already fixed. */
function coarseRules(css) {
  const at = "@media (pointer: coarse) {";
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(at, from);
    if (start === -1) break;
    let i = start + at.length;
    let depth = 1;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
    }
    blocks.push(css.slice(start + at.length, i - 1));
    from = i;
  }
  return blocks;
}

// ------------------------------------------------------------------- probe

/** The page that does the measuring.
 *
 * It reports its result base64-encoded, so that --dump-dom's HTML escaping
 * of quotes and angle brackets cannot corrupt it. */
const PROBE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body>
<iframe id="f" style="border:0"></iframe><pre id="out">PENDING</pre>
<script>
const q = new URLSearchParams(location.search);
const page = q.get('p'), W = Number(q.get('w'));
const f = document.getElementById('f');
f.style.width = W + 'px';
f.style.height = '3000px';
f.src = page;
function label(el) {
  const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
  const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  return '<' + el.tagName.toLowerCase() + '>' + (cls ? '.' + cls : '') + (text ? ' "' + text + '"' : '');
}
function report(value) {
  const json = JSON.stringify(value);
  document.getElementById('out').textContent =
    btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}
f.onload = async () => {
  let css = '';
  try { css = await (await fetch('/__touch-coarse.css')).text(); }
  catch (err) { report({ error: 'could not load the injected coarse rules: ' + err.message }); return; }
  const d = f.contentDocument, w = f.contentWindow;
  if (!d) { report({ error: 'the iframe document was not readable' }); return; }
  const style = d.createElement('style');
  style.textContent = css;
  d.head.appendChild(style);
  setTimeout(() => {
    try {
      const small = [];
      let measured = 0;
      for (const el of d.querySelectorAll('a,button,select,input,textarea,[role="button"]')) {
        const cs = w.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // A country on a map is the size of the country. SVG geometry is
        // WCAG 2.5.8's "essential" exemption: the world map on
        // /account/visited has 341 tappable <path>s and Haiti is 2x2.
        if (el.ownerSVGElement || el.tagName.toLowerCase() === 'svg') continue;
        // WCAG 2.5.8 exempts a target inside a sentence: the text around it
        // sets the line height and a 44px box would break the line. Measured
        // as the parent's OWN text nodes - its whole textContent includes
        // every sibling element's text, which excused every link in the
        // header and left these pages reporting one control each. The
        // "only N controls" tripwire below is what caught that.
        const parent = el.parentElement;
        const ownText = parent
          ? [...parent.childNodes]
              .filter((node) => node.nodeType === 3)
              .map((node) => node.textContent.trim())
              .join('')
          : '';
        if (el.tagName === 'A' && ownText.length > 1) continue;
        // A checkbox whose own <label> is the target. .check-row is 44px
        // tall and wraps both the box and its text, so the box is 20px by
        // design and hitting anywhere on the row works.
        const lab = el.closest('label');
        if (lab && lab !== el && lab.getBoundingClientRect().height >= ${MIN} - 0.5) continue;
        measured += 1;
        if (r.height < ${MIN} - 0.5 || r.width < ${MIN} - 0.5) {
          const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
          small.push({
            size: Math.round(r.width) + 'x' + Math.round(r.height),
            what: label(el),
            // What it is, without its text, so many copies of one control
            // group into one finding.
            kind: '<' + el.tagName.toLowerCase() + '>' + (cls ? '.' + cls : ''),
          });
        }
      }
      report({ measured, small });
    } catch (err) {
      report({ error: err && err.message ? err.message : String(err) });
    }
  }, 2600);
};
</script></body></html>
`;

// -------------------------------------------------------------------- main

const css = readFileSync(join(FRONTEND, "app", "globals.css"), "utf8");
const blocks = coarseRules(css);
if (blocks.length === 0 || !blocks.join("").includes("min-height")) {
  fail([
    "Found no @media (pointer: coarse) rules with a min-height in app/globals.css.",
    "",
    "Either the touch-target rules have been removed - in which case every",
    "control on every page is back to its desktop size on a phone - or this",
    "script can no longer find them. Both need a person.",
  ]);
}

if (!existsSync(join(FRONTEND, ".next"))) {
  fail([
    "No .next directory, so there is nothing to serve.",
    "",
    "This check drives the real pages, so it needs a build first:",
    "  npm run build && npm run check:touch-targets",
  ]);
}

const chrome = findChrome();
if (!chrome) {
  fail([
    "No Chrome or Chromium binary found, and this check cannot run without one.",
    "",
    "Set CHROME_PATH to one, or install Chromium. It is NOT skipped when the",
    "browser is missing: a check that quietly passes when it did not run is",
    "worse than one that does not exist.",
  ]);
}

const guide = guidePage();
const pages = guide ? [...PAGES, guide] : PAGES;
if (!guide) {
  fail([
    "Could not resolve a real destination slug from public/destinations,",
    "so the city guide pages would not be measured. They carry two of the",
    "controls this check exists for.",
  ]);
}

// Every route under app/ is either measured or excused.
const routes = [];
(function walk(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "api") continue;
    const route = `${prefix}/${entry.name}`;
    if (existsSync(join(dir, entry.name, "page.tsx"))) routes.push(route);
    walk(join(dir, entry.name), route);
  }
})(join(FRONTEND, "app"), "");

const unaccounted = routes.filter(
  (route) => !PAGES.includes(route) && !Object.hasOwn(ROUTES_NOT_CHECKED, route)
);
if (unaccounted.length > 0) {
  fail([
    "A page exists that this check neither measures nor excuses.\n",
    ...unaccounted.map((route) => `  ${route}`),
    "",
    "Add it to PAGES so its controls are measured on a phone, or to",
    "ROUTES_NOT_CHECKED with a reason. A page that is silently not checked",
    "is how every target in the list at the top of this file shipped.",
  ]);
}

const probePath = join(PUBLIC, "__touch-probe.html");
const cssPath = join(PUBLIC, "__touch-coarse.css");
/** Set once the server is up. The lifetime of `next start` - detached into
 * its own process group, signalled as a group, pipes destroyed - lives in
 * scripts/lib/devServer.mjs, where the six-hour CI hang that shaped it is
 * written down. */
let stopServer = null;

function cleanup() {
  for (const path of [probePath, cssPath]) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* best effort - a leftover probe is served but harmless */
    }
  }
  stopServer?.();
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

// Written BEFORE the server starts, deliberately: `next start` builds its
// list of public files at boot, so a file added afterwards 404s. That cost
// an afternoon of empty measurements once already.
mkdirSync(PUBLIC, { recursive: true });
writeFileSync(cssPath, blocks.join("\n"));
writeFileSync(probePath, PROBE_HTML);

const started = await startNextServer({ cwd: FRONTEND, probePath: "/__touch-probe.html" });
const port = started.port;
stopServer = started.stop;
if (!started.ok) {
  fail([
    `next start never answered on port ${port}, so nothing was measured.`,
    "",
    "Usually the port was already taken - a stray `next start` from an",
    "earlier run will do it. The server's own output follows.",
    "",
    started.log.trim() || "(the server printed nothing)",
  ]);
}

/** One page at one width, measured.
 *
 * THE DOM COMES BACK THROUGH A FILE, NOT A PIPE, and that is the whole
 * reason this function looks the way it does.
 *
 * It used to be spawnSync with stdout piped and `timeout: 90_000`, which
 * reads as bounded and is not. Node's timeout kills the process it
 * started; Chromium's zygote and renderer children inherit the stdout
 * pipe, and spawnSync goes on draining that pipe until every holder of
 * the far end exits. So the timeout fires, the browser dies, and the call
 * keeps waiting on grandchildren.
 *
 * It hung GitHub Actions for SIX HOURS a run - the job limit - on four of
 * five runs, which is how this guard went from catching a real defect to
 * being the reason CI was red for two weeks and Railway would not deploy.
 * Locally it merely looked slow, because here the children did eventually
 * exit, so nothing said the mechanism was wrong.
 *
 * Writing to a real file descriptor removes the pipe, and with it the
 * thing spawnSync can block on. --no-zygote stops the extra process being
 * forked at all, and --disable-dev-shm-usage is the standard fix for a CI
 * runner's small /dev/shm, where Chromium otherwise dies in ways that look
 * like a hang. */
function measure(page, width) {
  const url = `http://127.0.0.1:${port}/__touch-probe.html?p=${encodeURIComponent(page)}&w=${width}`;
  const dumpPath = join(PUBLIC, `__touch-dump-${process.pid}.html`);
  let fd;
  let run;
  try {
    fd = openSync(dumpPath, "w");
    run = spawnSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--no-zygote",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--window-size=1400,3200",
        // Fast-forwards the probe's own timers so --dump-dom sees the result
        // rather than "PENDING".
        "--virtual-time-budget=14000",
        "--dump-dom",
        url,
      ],
      // No pipes at all: stdout is the file, stderr is discarded.
      { stdio: ["ignore", fd, "ignore"], timeout: 90_000 }
    );
  } catch (err) {
    return { error: `could not run chrome: ${err.message}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }

  let dom = "";
  try {
    dom = readFileSync(dumpPath, "utf8");
  } catch {
    /* nothing written */
  } finally {
    rmSync(dumpPath, { force: true });
  }

  if (!dom) {
    const why = run?.error ? run.error.message : `chrome exited ${run?.status}`;
    return { error: `chrome wrote no DOM (${why})` };
  }
  const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  if (!match) return { error: "the probe's output element was not in the dumped DOM" };
  const payload = match[1].trim();
  if (payload === "PENDING") return { error: "the probe never finished (the page may not have loaded)" };
  try {
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch (err) {
    return { error: `could not read the probe's output: ${err.message}` };
  }
}

const problems = [];
let totalMeasured = 0;

const startedAt = Date.now();

/** The only bound that holds WHEREVER it is stuck.
 *
 * A deadline tested between iterations cannot help when one await never
 * returns, which is exactly how this script hung: ten minutes inside a
 * single fetch, never reaching the check at the top of the loop. A timer
 * fires regardless of what the main flow is doing, so this is the one
 * that turns "hangs forever" into "fails in eight minutes and says why".
 * Cleared on the way out, or the process would sit waiting for it. */
const watchdog = setTimeout(() => {
  console.error(
    `check:touch-targets gave up after ${Math.round(MAX_TOTAL_MS / 60000)} minutes.\n\n` +
      `  It was still running when the whole-run ceiling expired, which means\n` +
      `  something in the browser or the server is wedged rather than slow.\n` +
      `  Nothing is wrong with the pages - this says the check could not ask.\n`
  );
  cleanup();
  process.exit(1);
}, MAX_TOTAL_MS);

for (const page of pages) {
  for (const width of WIDTHS) {
    if (Date.now() - startedAt > MAX_TOTAL_MS) {
      problems.push(
        `gave up after ${Math.round((Date.now() - startedAt) / 1000)}s with ${page} @${width} ` +
          `still to measure - something is wrong with the browser, not with the pages`
      );
      break;
    }
    const result = measure(page, width);
    if (result.error) {
      problems.push(`${page} @${width}: ${result.error}`);
      continue;
    }
    // A page with almost no controls means the probe measured an error
    // page, not the page. Every page here has at least the logo, Sign in
    // and the language switch.
    if (result.measured < 3) {
      problems.push(
        `${page} @${width}: only ${result.measured} controls were measured, so this page did not render`
      );
      continue;
    }
    totalMeasured += result.measured;
    // Grouped by what the control IS rather than listed one by one: the
    // flag grid on /account/visited is 196 buttons of one kind, and 196
    // lines saying the same thing buries the other findings.
    const byKind = new Map();
    for (const { size, what, kind } of result.small) {
      const seen = byKind.get(kind);
      if (seen) seen.count += 1;
      else byKind.set(kind, { count: 1, size, what });
    }
    for (const [kind, { count, size, what }] of byKind) {
      problems.push(
        count === 1
          ? `${page} @${width}: ${size} ${what}`
          : `${page} @${width}: ${size} ${kind} x${count}, e.g. ${what}`
      );
    }
  }
}

clearTimeout(watchdog);
cleanup();

if (problems.length > 0) {
  console.error(`Controls under ${MIN}px on a phone.\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nGive it a class with a min-height in the (pointer: coarse) block of\n` +
      `app/globals.css. min-height, not padding, so nothing moves on a desktop\n` +
      `and an inline padding set by the page does not undo it.\n\n` +
      `If the target is genuinely inside a sentence, WCAG 2.5.8 exempts it and\n` +
      `so does this check - but a link that is the only way out of a page is\n` +
      `not fine print. Put it on its own line and give it .inline-link.`
  );
  process.exit(1);
}

console.log(
  `Every touch target is ${MIN}px or more ` +
    `(${totalMeasured} controls across ${pages.length} pages at ${WIDTHS.join("/")}px).`
);

// Explicit, and not belt-and-braces: falling off the end of the file means
// waiting for the event loop to drain, and a single surviving grandchild
// holding an inherited pipe is enough to stop that forever. The failure
// path above already exits; so does this one now.
process.exit(0);
