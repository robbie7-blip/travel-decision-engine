// The Postgres side of the worker: finished trips, kept as rows.
//
// WHY BOTH. Redis stays what it is good at - the queue, live progress,
// rate limits, anything short-lived that has to be fast. Postgres is for
// the records worth asking questions of later: which cities people plan,
// how often a check fires, and (next) a signed-in traveller's trips on any
// device. A job's Redis record is a key that expires; a row can be
// queried.
//
// THE SAME LIFETIME AS REDIS, and that is a promise, not a default: the
// privacy page tells travellers how long a trip is kept, and copying it
// into a second store must not quietly extend that. Each row carries
// expires_at = when it finished + the job's own TTL (ttlForJob: thirty
// days, or about thirteen months for a signed-in account), and
// deleteExpiredTrips removes it on the same schedule Redis would.
//
// OPTIONAL BY CONSTRUCTION. No DATABASE_URL, no database: every function
// here is a no-op, and nothing about generating a trip depends on it. A
// write that fails is logged and dropped - a traveller must never lose a
// trip, or wait for one, because the archive was unreachable.
//
// Run: npm run test:db (needs a Postgres; see the test's header)

import { Pool } from "pg";
import { ttlForJob, type Job } from "./jobs";

let pool: Pool | null = null;
let migrated: Promise<void> | null = null;

/** The pool, or null when this deployment has no database. */
export function getDb(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      // Small: the worker runs four jobs at once and writes one row per
      // job. A serverless Postgres counts connections.
      max: 4,
      connectionTimeoutMillis: 5_000,
      // A query that hangs must not hold a worker slot.
      query_timeout: 10_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (e) => console.error("[db] idle client error:", e.message));
  }
  return pool;
}

/** Schema, as numbered steps applied once each, in order. Append only:
 * a step that has run in production is never edited, because the
 * database it ran against will never run it again. */
export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      create table if not exists trips (
        id            text primary key,
        kind          text not null,              -- 'generate' or 'refine'
        status        text not null,              -- 'done' or 'error'
        test_mode     boolean not null default false,
        created_at    timestamptz not null,
        finished_at   timestamptz not null,
        expires_at    timestamptz not null,
        language      text not null,
        destinations  text[] not null,
        start_date    date,
        end_date      date,
        day_count     integer,
        party_size    integer,
        -- The whole brief, including the private fields (diet, mobility,
        -- budget). Server-side only, like the Redis record it copies; the
        -- public trip page never reads this table.
        brief         jsonb not null,
        itinerary     jsonb,
        quality       jsonb,
        timings       jsonb,
        cost_usd      numeric(10, 4),
        error         text
      );
      create index if not exists trips_finished_at on trips (finished_at desc);
      create index if not exists trips_expires_at on trips (expires_at);
    `,
  },
];

/** Applies whatever has not run yet. Once per process. */
export function migrate(): Promise<void> {
  const db = getDb();
  if (!db) return Promise.resolve();
  migrated ??= (async () => {
    const client = await db.connect();
    try {
      // One worker at a time, across deploys: two replicas starting
      // together must not both run step 1.
      await client.query("select pg_advisory_lock(84211)");
      await client.query(
        "create table if not exists schema_migrations (id integer primary key, applied_at timestamptz not null default now())"
      );
      const { rows } = await client.query<{ id: number }>("select id from schema_migrations");
      const done = new Set(rows.map((r) => r.id));
      for (const step of MIGRATIONS) {
        if (done.has(step.id)) continue;
        await client.query("begin");
        try {
          await client.query(step.sql);
          await client.query("insert into schema_migrations (id) values ($1)", [step.id]);
          await client.query("commit");
          console.log(`[db] applied migration ${step.id}`);
        } catch (e) {
          await client.query("rollback");
          throw e;
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock(84211)").catch(() => {});
      client.release();
    }
  })().catch((e) => {
    // Let the next call try again rather than caching the failure.
    migrated = null;
    throw e;
  });
  return migrated;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The row for a finished job. Pure, so what is stored is tested. */
export function tripRow(job: Job, costUsd: number, now = Date.now()) {
  const brief = job.brief;
  const days = job.result?.days?.length ?? null;
  return {
    id: job.id,
    kind: job.refinement ? "refine" : "generate",
    status: job.status === "done" ? "done" : "error",
    test_mode: job.testMode === true,
    created_at: new Date(job.createdAt),
    finished_at: new Date(now),
    expires_at: new Date(now + ttlForJob(job) * 1000),
    language: brief.language === "bg" ? "bg" : "en",
    destinations: Array.isArray(brief.destinations) ? brief.destinations.filter((d) => typeof d === "string") : [],
    start_date: typeof brief.start_date === "string" && ISO_DATE.test(brief.start_date) ? brief.start_date : null,
    end_date: typeof brief.end_date === "string" && ISO_DATE.test(brief.end_date) ? brief.end_date : null,
    day_count: days,
    party_size: Number.isInteger(brief.party_size) ? brief.party_size : null,
    brief,
    itinerary: job.result ?? null,
    quality: job.quality ?? null,
    timings: job.timings ?? null,
    cost_usd: Number.isFinite(costUsd) ? Math.round(costUsd * 10_000) / 10_000 : null,
    error: job.error ?? null,
  };
}

/** Saves a finished job. Never throws: see the header. */
export async function saveTripRecord(job: Job, costUsd: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await migrate();
    const r = tripRow(job, costUsd);
    await db.query(
      `insert into trips (id, kind, status, test_mode, created_at, finished_at, expires_at, language,
         destinations, start_date, end_date, day_count, party_size, brief, itinerary, quality, timings,
         cost_usd, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       on conflict (id) do update set
         kind = excluded.kind, status = excluded.status, test_mode = excluded.test_mode,
         finished_at = excluded.finished_at, expires_at = excluded.expires_at,
         language = excluded.language, destinations = excluded.destinations,
         start_date = excluded.start_date, end_date = excluded.end_date, day_count = excluded.day_count,
         party_size = excluded.party_size, brief = excluded.brief, itinerary = excluded.itinerary,
         quality = excluded.quality, timings = excluded.timings, cost_usd = excluded.cost_usd,
         error = excluded.error`,
      [
        r.id, r.kind, r.status, r.test_mode, r.created_at, r.finished_at, r.expires_at, r.language,
        r.destinations, r.start_date, r.end_date, r.day_count, r.party_size,
        JSON.stringify(r.brief), r.itinerary === null ? null : JSON.stringify(r.itinerary),
        r.quality === null ? null : JSON.stringify(r.quality), r.timings === null ? null : JSON.stringify(r.timings),
        r.cost_usd, r.error,
      ]
    );
  } catch (e) {
    console.error(`[db] could not save trip ${job.id}:`, e instanceof Error ? e.message : e);
  }
}

/** Removes trips past their lifetime. Returns how many went. */
export async function deleteExpiredTrips(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    await migrate();
    const res = await db.query("delete from trips where expires_at < now()");
    return res.rowCount ?? 0;
  } catch (e) {
    console.error("[db] expiry sweep failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** On startup and every six hours: migrations, then the expiry sweep.
 * Six hours is well inside a thirty-day lifetime; nothing hinges on the
 * minute a row goes. */
export function startDbMaintenance(): void {
  if (!getDb()) {
    console.log("[db] DATABASE_URL not set - trips are kept in Redis only");
    return;
  }
  const run = async () => {
    try {
      await migrate();
      const removed = await deleteExpiredTrips();
      if (removed > 0) console.log(`[db] removed ${removed} expired trip(s)`);
    } catch (e) {
      console.error("[db] maintenance failed:", e instanceof Error ? e.message : e);
    }
  };
  void run();
  setInterval(() => void run(), 6 * 60 * 60 * 1000).unref?.();
}

/** For tests: close the pool so the process can exit. */
export async function closeDb(): Promise<void> {
  await pool?.end().catch(() => {});
  pool = null;
  migrated = null;
}
