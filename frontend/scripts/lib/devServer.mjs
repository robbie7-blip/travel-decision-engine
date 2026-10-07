// Starting `next start` for a check, and finding a browser to drive it
// with.
//
// Extracted from scripts/checkTouchTargets.mjs when a second check needed
// the same thing (checkDartFallback.mjs). Copying it would have been
// faster and wrong: what is below is not boilerplate, it is the residue of
// specific failures, and the comments are the valuable part. Two copies
// means the next failure gets fixed in one of them.
//
// THE ONE THAT HUNG CI FOR SIX HOURS A RUN. `next start` is spawned
// through npx, so the server is npx's CHILD. SIGTERM to npx never reached
// it, the server kept the stdout and stderr pipes it inherited open,
// node's event loop never drained, and the process lived until GitHub
// killed the job - after printing the correct answer. Hence: detached,
// into its own process group, the whole group signalled (a negative pid is
// the group), SIGKILL after SIGTERM because next does not always honour
// the polite one, and the pipes destroyed so a survivor cannot hold the
// loop open regardless.
//
// AND THE ONE THAT HUNG A TEN-MINUTE RUN WITH NO OUTPUT. fetch() has no
// default timeout. A request to a port nothing is listening on usually
// fails at once, but "usually" is not "always", and the run that exposed
// it sat in ep_poll with no children, no listening port and no way to tell
// anyone. So every poll carries its own deadline, the loop carries a
// wall-clock one rather than counting attempts, and a server that has
// exited ends it immediately.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** A Chrome or Chromium binary, or null.
 *
 * A caller that gets null must FAIL rather than skip. A check that quietly
 * passes when its dependency is missing is the dormant guard this repo has
 * already learned not to ship, twice. */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (existsSync(pwRoot)) {
    for (const entry of readdirSync(pwRoot).sort().reverse()) {
      const candidate = join(pwRoot, entry, "chrome-linux", "chrome");
      if (entry.startsWith("chromium-") && existsSync(candidate)) return candidate;
    }
  }
  for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  return null;
}

/**
 * Starts `next start` on a random high port and waits for it to answer.
 *
 * Returns { ok, port, log, stop }. On failure `ok` is false and `log`
 * carries the server's own output, which is the only thing that explains
 * a port already in use. The caller formats the message: these checks say
 * different things about what was not measured, and that sentence is the
 * most useful line in a failing run.
 *
 * `probePath` is the URL path polled until the server answers. It must be
 * something the server really serves - a file written BEFORE this is
 * called, because `next start` builds its list of public files at boot and
 * one added afterwards 404s. That cost an afternoon of empty measurements
 * once.
 *
 * stop() is idempotent and safe to call from an exit handler.
 */
export async function startNextServer({ cwd, probePath, timeoutMs = 45_000 }) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    detached: true,
  });

  let log = "";
  server.stdout.on("data", (chunk) => {
    log += chunk;
  });
  server.stderr.on("data", (chunk) => {
    log += chunk;
  });

  // The server exiting is a result, not something to wait out. Without
  // this, a dead `next start` left the poll below running against a port
  // nobody holds until its deadline.
  let exited = false;
  server.on("exit", (code, signal) => {
    exited = true;
    log += `\n[next start exited: code ${code}, signal ${signal}]`;
  });

  let stopped = false;
  const stop = () => {
    if (stopped || server.killed) return;
    stopped = true;
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      try {
        process.kill(-server.pid, signal);
      } catch {
        try {
          server.kill(signal);
        } catch {
          /* already gone */
        }
      }
    }
    try {
      server.stdout?.destroy();
      server.stderr?.destroy();
      server.unref();
    } catch {
      /* already gone */
    }
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) return { ok: false, port, log, stop };
    try {
      const res = await fetch(`http://127.0.0.1:${port}${probePath}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return { ok: true, port, log, stop };
    } catch {
      /* not up yet, or this attempt timed out */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return { ok: false, port, log, stop };
}
