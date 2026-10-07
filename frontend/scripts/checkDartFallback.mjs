// The dart still works on a browser that cannot draw the globe.
//
// WHY NOTHING ELSE CAN CATCH THIS. GlobeDart decides whether to render the
// globe by trying to create a WebGL context, inside a useEffect. So server
// rendering never gets past the "still deciding" placeholder, and the
// react-dom/server suites cannot see either real branch. The fallback only
// exists at runtime, in a browser that genuinely has no WebGL - which is
// to say, in none of the places this repo currently looks.
//
// AND IT RECENTLY BECAME LOAD-BEARING. That branch used to render the
// wheel. The wheel is gone, and it now renders the dart with no canvas:
// the same throwDart, the same result card, nothing to watch. It also
// needed a behavioural fix that nothing else would notice if it were
// undone - throwIt must not set inFlight when there is no canvas, because
// onArrived never comes and the button would sit disabled until a backstop
// timer fired. A dead control, waiting for a camera move that is never
// going to happen.
//
// So this drives the real built page twice: once with WebGL switched off
// and once with it on, clicking the button both times.
//
// CDP over a debugging port rather than Playwright, which this package
// deliberately does not depend on (see makeLaunchScreens.mjs), and rather
// than the Chromium CLI, which cannot click anything.
//
// Needs a build: it serves .next. Run: npm run build && npm run check:dart-fallback

import { existsSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findChrome, startNextServer } from "./lib/devServer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

/** The two runs. Chromium has no single switch for "pretend there is no
 * WebGL", so the off case names every one that turns a piece of it off -
 * and the run asserts that a context really could not be created, because
 * a run where WebGL quietly still worked would pass while proving
 * nothing. */
const RUNS = [
  {
    name: "no WebGL (the fallback)",
    webgl: false,
    args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis", "--disable-gpu"],
    settleMs: 1500,
  },
  {
    name: "WebGL (the globe)",
    webgl: true,
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    // The globe branch has a flight to sit through before the result
    // appears; the fallback resolves on the click. dartFlightMs is 3200
    // and the backstop adds 1600, so this clears both.
    settleMs: 6500,
  },
];

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

if (!existsSync(join(FRONTEND, ".next"))) {
  fail([
    "No .next directory, so there is nothing to serve.",
    "",
    "This check drives the real page, so it needs a build first:",
    "  npm run build && npm run check:dart-fallback",
  ]);
}

let stopServer = null;
process.on("exit", () => stopServer?.());
process.on("SIGINT", () => {
  stopServer?.();
  process.exit(130);
});

const started = await startNextServer({ cwd: FRONTEND, probePath: "/decide-for-me" });
stopServer = started.stop;
if (!started.ok) {
  fail([
    `next start never answered on port ${started.port}, so nothing was checked.`,
    "",
    "Usually the port was already taken - a stray `next start` from an",
    "earlier run will do it. The server's own output follows.",
    "",
    started.log.trim() || "(the server printed nothing)",
  ]);
}

/** One browser, driven over CDP, reporting what the page did. */
async function run({ args, settleMs }, port) {
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--no-zygote",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "dart-fallback-"))}`,
      ...args,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  // Port 0 means the browser picks one and prints it on stderr. Asking for
  // a fixed port is how two of these collide on a busy machine.
  let stderr = "";
  const wsUrl = await new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(null), 30_000);
    browser.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /ws:\/\/[^\s]+/.exec(stderr);
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
  if (!wsUrl) {
    browser.kill();
    return { error: `the browser never reported a debugging endpoint. Its output:\n${stderr.trim()}` };
  }

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async (expression) => {
    const result = await send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  try {
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId
    );
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/decide-for-me` }, sessionId);
    // The WebGL probe runs in an effect, so the page has to hydrate before
    // either branch exists.
    await evaluate(`new Promise((done) => {
      const settle = () => setTimeout(() => done(true), 2000);
      document.readyState === "complete" ? settle() : window.addEventListener("load", settle);
    })`);

    const webglWorks = await evaluate(`(() => {
      const canvas = document.createElement("canvas");
      return (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) !== null;
    })()`);

    const before = await evaluate(`({
      canvases: document.querySelectorAll("canvas").length,
      button: !!document.querySelector(".spin-button"),
      results: document.querySelectorAll(".spin-result-card").length,
    })`);

    if (!before.button) return { webglWorks, before, error: "there is no throw button on the page" };

    await evaluate(`document.querySelector(".spin-button").click()`);
    await evaluate(`new Promise((done) => setTimeout(() => done(true), ${settleMs}))`);

    const after = await evaluate(`({
      results: document.querySelectorAll(".spin-result-card").length,
      country: (document.querySelector(".spin-result-city")?.innerText ?? "").trim(),
      planHref: document.querySelector(".spin-plan")?.getAttribute("href") ?? "",
      disabled: !!document.querySelector(".spin-button")?.disabled,
    })`);
    return { webglWorks, before, after };
  } finally {
    socket.close();
    // Kill it AND let go of its pipes. Killing alone is not enough: this
    // script printed the right answer and then hung forever, because
    // Chromium's zygote and renderer children inherit the stderr pipe
    // this reads the debugging endpoint from, and node's event loop stays
    // alive while anything holds the far end. The same failure the server
    // half of scripts/lib/devServer.mjs is written around, in the half I
    // had not copied.
    browser.kill();
    try {
      browser.stdout?.destroy();
      browser.stderr?.destroy();
      browser.unref();
    } catch {
      /* already gone */
    }
  }
}

const problems = [];
for (const spec of RUNS) {
  let outcome;
  try {
    outcome = await run(spec, started.port);
  } catch (error) {
    problems.push(`${spec.name}: ${String(error)}`);
    continue;
  }
  if (outcome.error) {
    problems.push(`${spec.name}: ${outcome.error}`);
    continue;
  }
  const { webglWorks, before, after } = outcome;

  if (webglWorks !== spec.webgl) {
    problems.push(
      `${spec.name}: WebGL was ${webglWorks ? "available" : "unavailable"} when the run needs it ` +
        `${spec.webgl ? "available" : "unavailable"}, so this run proved nothing`
    );
    continue;
  }
  if (spec.webgl && before.canvases < 1) problems.push(`${spec.name}: no globe canvas rendered`);
  if (!spec.webgl && before.canvases !== 0) {
    problems.push(`${spec.name}: a canvas rendered anyway (${before.canvases})`);
  }
  if (before.results !== 0) problems.push(`${spec.name}: a result was showing before any throw`);
  if (after.results !== 1) problems.push(`${spec.name}: the throw produced ${after.results} result cards`);
  if (!after.country) problems.push(`${spec.name}: the result card names no country`);
  if (!after.planHref.startsWith("/?dest=")) {
    problems.push(`${spec.name}: the plan link is "${after.planHref}"`);
  }
  // The one that only breaks without a canvas: onArrived never comes, so a
  // throw that goes through inFlight leaves this disabled forever.
  if (after.disabled) problems.push(`${spec.name}: the throw button is still disabled after the throw`);
}

if (problems.length > 0) {
  fail([
    "The dart is broken on at least one branch of /decide-for-me:",
    "",
    ...problems.map((p) => `  ${p}`),
    "",
    "components/GlobeDart.tsx renders the globe only where WebGL is available,",
    "and the throw has to work either way - the globe is the presentation, not",
    "the answer. If the no-WebGL run is the one failing, check that throwIt",
    "still returns early instead of setting inFlight when `webgl` is false:",
    "without a canvas, onArrived never fires and the button stays disabled",
    "until the backstop timer.",
  ]);
}

console.log(`The dart works with and without WebGL (${RUNS.length} branches driven on the real page).`);

// Explicit, and not belt-and-braces. Everything above is cleaned up, but
// this script's whole job is to drive browsers that spawn their own
// children, and the cost of one of them outliving its pipes is a CI job
// that hangs until the runner kills it rather than a test that fails. An
// exit code is the only thing a check actually owes anybody.
stopServer?.();
process.exit(0);
