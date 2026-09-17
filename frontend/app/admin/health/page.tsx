// Password-protected (see middleware.ts) answer to one question: is
// anything quietly broken right now?
//
// Not an uptime check - /api/health stays public and boring for that. This
// is the configuration view, and it exists because the two halves of this
// product cannot see each other. The Next.js app on Vercel and the worker
// on Railway share a Redis queue and nothing else, so a key set on one and
// missing on the other produces no error anywhere: generation succeeds with
// no photos, or every model call 400s, or the queue fills with jobs nobody
// is reading. This page is the only place both environments are visible at
// once.
//
// Presence only. It reads whether a variable is set, never what it is.

import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { MarkAdminUi } from "@/components/MarkAdminUi";
import {
  JOBS_QUEUE_KEY,
  WORKER_FAILURES_KEY,
  WORKER_FAILURES_KEPT,
  WORKER_HEARTBEAT_KEY,
  readWorkerFailure,
  type WorkerFailure,
  type WorkerHeartbeat,
} from "@/lib/jobs";
import {
  checkFrontendEnv,
  checkWorkerEnv,
  describeAge,
  heartbeatAgeSeconds,
  isWorkerHeartbeat,
  verdictFor,
  worstOf,
  type CheckedEnv,
  type Verdict,
} from "@/lib/health";

export const dynamic = "force-dynamic"; // a cached health page is a lie
export const runtime = "nodejs";

interface RedisState {
  reachable: boolean;
  /** Round trip for a PING, in milliseconds. Vercel and Upstash are not
   * necessarily in the same region, and a slow queue read shows up in every
   * poll the trip page makes. */
  pingMs: number | null;
  queueDepth: number | null;
  heartbeat: WorkerHeartbeat | null;
  /** Newest first, as the worker pushed them. */
  failures: WorkerFailure[];
  /** Entries in the list this build could not read - an older worker's
   * shape, or a half-written value. Counted rather than dropped silently,
   * because "no failures" and "three failures I cannot show you" are
   * different answers on a page whose whole job is saying what is wrong. */
  failuresUnreadable: number;
  error: string | null;
}

async function loadRedisState(): Promise<RedisState> {
  const empty: RedisState = {
    reachable: false,
    pingMs: null,
    queueDepth: null,
    heartbeat: null,
    failures: [],
    failuresUnreadable: 0,
    error: null,
  };

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "Redis is not configured" };
  }

  // Reachability is settled by the ping alone, and nothing after it can
  // un-settle it. Wrapping the whole sequence in one catch meant a
  // malformed heartbeat - the very case the JSON.parse below exists to
  // handle - would be reported as "Redis unreachable, every trip fails at
  // submit" on a completely healthy system. On a page whose only job is to
  // say what is actually wrong, that is the worst possible bug.
  let pingMs: number | null = null;
  try {
    const startedAt = Date.now();
    await redis.ping();
    pingMs = Date.now() - startedAt;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "Redis request failed" };
  }

  let queueDepth: number | null = null;
  let heartbeat: WorkerHeartbeat | null = null;
  let failures: WorkerFailure[] = [];
  let failuresUnreadable = 0;
  let error: string | null = null;

  try {
    const [depth, raw, rawFailures] = await Promise.all([
      redis.llen(JOBS_QUEUE_KEY),
      redis.get<string | WorkerHeartbeat>(WORKER_HEARTBEAT_KEY),
      // One read for the whole list. The worker caps it at
      // WORKER_FAILURES_KEPT with an LTRIM on every push, so this cannot
      // grow past that however many jobs fail.
      redis.lrange<string | WorkerFailure>(WORKER_FAILURES_KEY, 0, WORKER_FAILURES_KEPT - 1),
    ]);
    queueDepth = depth;
    const read = (Array.isArray(rawFailures) ? rawFailures : []).map(readWorkerFailure);
    failures = read.filter((f): f is WorkerFailure => f !== null);
    failuresUnreadable = read.length - failures.length;
    // Upstash's client parses JSON values for you, except when it doesn't
    // (older writes, non-JSON strings), so handle both - same as loadJob.
    const parsed = raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed !== null && !isWorkerHeartbeat(parsed)) {
      // Present but unreadable - an older worker build's shape, or a
      // half-written value. Not the same thing as absent, and saying so
      // is the difference between "go restart the worker" and "go look at
      // what is in that key".
      error = "the heartbeat in Redis is not in a shape this build understands";
    } else {
      heartbeat = parsed;
    }
  } catch (e) {
    // Redis answered the ping, so it is up; something about these two
    // reads is not. Say so instead of blaming the connection.
    error = e instanceof Error ? e.message : "Could not read the queue or the heartbeat";
  }

  return { reachable: true, pingMs, queueDepth, heartbeat, failures, failuresUnreadable, error };
}

// Text and rules take different colours for the same verdict, because the
// gold is a fill colour: --unverified on the page background measures
// 2.04:1, which is a fine 3px rule and unreadable as 12px type. Same split
// the rest of the app already makes (--brand-gold vs --brand-gold-ink); the
// pairs used here are in scripts/checkContrast.mjs.
const VERDICT_TEXT: Record<Verdict, string> = {
  ok: "var(--grounded)",
  warn: "var(--brand-gold-ink)",
  down: "var(--infeasible)",
};

const VERDICT_RULE: Record<Verdict, string> = {
  ok: "var(--grounded)",
  warn: "var(--unverified)",
  down: "var(--infeasible)",
};

// Colour is never the only carrier (WCAG 1.4.1): every row that is coloured
// also says "set", "MISSING" or "not set" in words.
const VERDICT_WORD: Record<Verdict, string> = {
  ok: "OK",
  warn: "DEGRADED",
  down: "DOWN",
};

function Card({ title, verdict, children }: { title: string; verdict: Verdict; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderLeft: `3px solid ${VERDICT_RULE[verdict]}`,
        borderRadius: 6,
        padding: "16px 20px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <h2 className="font-display" style={{ fontSize: 16, margin: 0 }}>
          {title}
        </h2>
        <span style={{ color: VERDICT_TEXT[verdict], fontSize: 11, letterSpacing: "0.08em" }}>
          {VERDICT_WORD[verdict]}
        </span>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.8 }}>
      <span style={{ color: "var(--ink-dim)", minWidth: 130 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function EnvTable({ checks }: { checks: CheckedEnv[] }) {
  return (
    <div style={{ marginTop: 4 }}>
      {checks.map((check) => {
        const verdict = verdictFor(check);
        const status = check.weak
          ? "TOO WEAK"
          : check.present
            ? "set"
            : check.criticality === "optional"
              ? "not set"
              : "MISSING";
        return (
          <div
            key={check.name}
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 12,
              lineHeight: 1.9,
              borderTop: "1px solid var(--line)",
              paddingTop: 2,
            }}
          >
            <span style={{ minWidth: 220 }}>{check.name}</span>
            <span style={{ color: VERDICT_TEXT[verdict], minWidth: 64 }}>{status}</span>
            <span style={{ color: check.weak ? VERDICT_TEXT[verdict] : "var(--ink-dim)", flex: 1, minWidth: 200 }}>
              {check.weakBecause ?? check.what}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** How recent a failure has to be for this card to read DEGRADED.
 *
 * The list keeps two weeks, which is the right memory for spotting a
 * pattern and the wrong one for a verdict: a bad afternoon a fortnight ago
 * must not leave the page permanently amber. Six hours is "this is
 * happening now". */
const FAILURE_FRESH_MS = 6 * 60 * 60 * 1000;

function FailureEntry({ failure }: { failure: WorkerFailure }) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "10px 0", fontSize: 12, lineHeight: 1.7 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "var(--ink-dim)" }}>
        <span>{new Date(failure.at).toLocaleString("en-GB")}</span>
        <span style={{ color: VERDICT_TEXT.down }}>{failure.name}</span>
        <span>job {failure.jobId}</span>
        {failure.days !== null && <span>{failure.days}-day trip</span>}
      </div>
      <div style={{ marginTop: 4, wordBreak: "break-word" }}>{failure.message || "(no message)"}</div>
      {/* Which stages finished. This is the half a stack trace does not
          give: the same throw means different things before and after
          verification has run. */}
      {failure.reached.length > 0 && (
        <div style={{ marginTop: 4, color: "var(--ink-dim)" }}>reached: {failure.reached.join(" + ")}</div>
      )}
      {failure.stack.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", color: "var(--grounded)" }}>stack</summary>
          <pre
            style={{
              margin: "6px 0 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 11,
              color: "var(--ink-dim)",
            }}
          >
            {failure.stack.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}

export default async function HealthAdminPage() {
  const redis = await loadRedisState();
  const frontendChecks = checkFrontendEnv();
  const workerChecks = redis.heartbeat ? checkWorkerEnv(redis.heartbeat) : null;

  const frontendVerdict = worstOf(frontendChecks.map(verdictFor));
  // Unreachable is down; reachable but with a failed read is degraded -
  // the queue still works, we just could not see into it.
  const redisVerdict: Verdict = !redis.reachable ? "down" : redis.error ? "warn" : "ok";
  // No heartbeat is "down" and not "warn" on purpose. Either the worker is
  // not running, or it is running a build from before the heartbeat
  // existed - and both of those are things to go and look at rather than
  // note in passing.
  // Down only when we actually looked and found nothing. If the read
  // itself failed, the worker's state is unknown - saying "anything queued
  // now will sit untouched" would be the same confident misdiagnosis the
  // Redis card was just fixed for, one level down.
  const workerVerdict: Verdict = workerChecks
    ? worstOf(workerChecks.map(verdictFor))
    : redis.error
      ? "warn"
      : "down";
  const overall = worstOf([frontendVerdict, redisVerdict, workerVerdict]);

  const age = redis.heartbeat ? heartbeatAgeSeconds(redis.heartbeat) : null;

  // Deliberately NOT folded into `overall`. That banner answers a
  // configuration question - "is anything set on one host and missing on
  // the other" - and a generation that threw on a model-written field is a
  // different kind of problem with different words. Folding it in would
  // have the page say "something switched off that nobody would notice"
  // about a TypeError. The card carries its own verdict and sits first,
  // which is where the answer to "what just broke" belongs.
  const newestFailureAt = redis.failures[0]?.at ?? null;
  const failuresVerdict: Verdict =
    newestFailureAt !== null && Date.now() - newestFailureAt < FAILURE_FRESH_MS ? "warn" : "ok";

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
      <h1 className="font-display" style={{ fontSize: 24, marginBottom: 4 }}>
        Health
      </h1>
      <p style={{ color: VERDICT_TEXT[overall], fontSize: 13, marginBottom: 4 }}>
        {overall === "ok"
          ? "Everything that can fail silently is configured."
          : overall === "warn"
            ? "Running, with something switched off that nobody would notice."
            : "Something is down."}
      </p>
      <div style={{ color: "var(--ink-dim)", fontSize: 13, marginBottom: 24 }}>
        <Link href="/admin/stats" style={{ color: "var(--grounded)" }}>
          stats →
        </Link>{" "}
        <Link href="/admin/feedback" style={{ color: "var(--grounded)", marginLeft: 12 }}>
          feedback →
        </Link>
      </div>

      <Card title="Failed generations" verdict={failuresVerdict}>
        {redis.failures.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0, lineHeight: 1.7 }}>
            Nothing has failed in the last two weeks - or the worker is running a build from before it
            started recording failures here.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 4px", lineHeight: 1.7 }}>
              The real error behind each one, newest first. A traveler is told &ldquo;Unexpected error
              generating itinerary&rdquo; whenever the thrown value matched none of the named cases, which
              means this list is the only place that sentence is ever explained.
            </p>
            {redis.failures.map((failure, i) => (
              <FailureEntry key={`${failure.jobId}-${failure.at}-${i}`} failure={failure} />
            ))}
            {redis.failuresUnreadable > 0 && (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "10px 0 0", lineHeight: 1.7 }}>
                {redis.failuresUnreadable} further{" "}
                {redis.failuresUnreadable === 1 ? "entry was" : "entries were"} in the list but not in a
                shape this build understands.
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="Worker" verdict={workerVerdict}>
        {redis.heartbeat && age !== null ? (
          <>
            <Field label="Last heartbeat" value={describeAge(age)} />
            <Field label="Started" value={new Date(redis.heartbeat.startedAt).toLocaleString("en-GB")} />
            <Field label="Consumers" value={String(redis.heartbeat.concurrency)} />
            <Field label="Day model" value={redis.heartbeat.dayModel ?? "default"} />
            <Field label="Two-phase" value={redis.heartbeat.twoPhase ? "on" : "off (single-call fallback)"} />
            <div style={{ marginTop: 12 }}>{workerChecks && <EnvTable checks={workerChecks} />}</div>
          </>
        ) : redis.error ? (
          <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0, lineHeight: 1.7 }}>
            The heartbeat could not be read, so the worker&rsquo;s state is unknown - this is not a report that
            it is down. See the Redis card below for what failed.
          </p>
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0, lineHeight: 1.7 }}>
            No heartbeat in Redis. Either the worker is not running, or it is running a build from before it
            started writing one. Anything queued now will sit in the queue untouched.
          </p>
        )}
      </Card>

      <Card title="Redis" verdict={redisVerdict}>
        {redis.reachable ? (
          <>
            <Field label="Ping" value={`${redis.pingMs} ms`} />
            <Field
              label="Queue depth"
              value={
                redis.queueDepth === null
                  ? "could not be read"
                  : redis.queueDepth === 0
                    ? "0 (nothing waiting)"
                    : `${redis.queueDepth} waiting${redis.heartbeat ? "" : " with nothing reading them"}`
              }
            />
            {redis.error && (
              <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "8px 0 0", lineHeight: 1.7 }}>
                Redis answered its ping, so the queue itself is up, but reading it failed: {redis.error}
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0, lineHeight: 1.7 }}>
            {redis.error ?? "Unreachable."} Nothing can be queued, so every trip fails at submit.
          </p>
        )}
      </Card>

      <Card title="This deployment" verdict={frontendVerdict}>
        <EnvTable checks={frontendChecks} />
      </Card>

      <p style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.7, marginTop: 24 }}>
        Only whether a variable is set is ever read or shown here, never its value. The worker&rsquo;s side of
        that list arrives through its heartbeat, since this deployment cannot see Railway&rsquo;s environment.
      </p>
    </div>
  );
}
