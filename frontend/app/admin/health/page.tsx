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
import { JOBS_QUEUE_KEY, WORKER_HEARTBEAT_KEY, type WorkerHeartbeat } from "@/lib/jobs";
import {
  checkFrontendEnv,
  checkWorkerEnv,
  describeAge,
  heartbeatAgeSeconds,
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
  error: string | null;
}

async function loadRedisState(): Promise<RedisState> {
  const empty: RedisState = {
    reachable: false,
    pingMs: null,
    queueDepth: null,
    heartbeat: null,
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
  let error: string | null = null;

  try {
    const [depth, raw] = await Promise.all([
      redis.llen(JOBS_QUEUE_KEY),
      redis.get<string | WorkerHeartbeat>(WORKER_HEARTBEAT_KEY),
    ]);
    queueDepth = depth;
    // Upstash's client parses JSON values for you, except when it doesn't
    // (older writes, non-JSON strings), so handle both - same as loadJob.
    heartbeat = raw == null ? null : typeof raw === "string" ? (JSON.parse(raw) as WorkerHeartbeat) : raw;
  } catch (e) {
    // Redis answered the ping, so it is up; something about these two
    // reads is not. Say so instead of blaming the connection.
    error = e instanceof Error ? e.message : "Could not read the queue or the heartbeat";
  }

  return { reachable: true, pingMs, queueDepth, heartbeat, error };
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
        const status = check.present ? "set" : check.criticality === "optional" ? "not set" : "MISSING";
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
            <span style={{ color: "var(--ink-dim)", flex: 1, minWidth: 200 }}>{check.what}</span>
          </div>
        );
      })}
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
  const workerVerdict: Verdict = workerChecks ? worstOf(workerChecks.map(verdictFor)) : "down";
  const overall = worstOf([frontendVerdict, redisVerdict, workerVerdict]);

  const age = redis.heartbeat ? heartbeatAgeSeconds(redis.heartbeat) : null;

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
