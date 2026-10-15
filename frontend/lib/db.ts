// The site's read-only view of the Postgres archive of finished trips.
//
// The worker owns the schema and the writes (worker/src/db.ts); the site
// only reads, and for now only for /admin/health. Small pool: a serverless
// function holds its connections for as long as it is warm.

import { Pool } from "pg";

let pool: Pool | null = null;

export function getDb(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  pool ??= new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
  return pool;
}

export interface DbState {
  configured: boolean;
  reachable: boolean;
  pingMs: number | null;
  /** Null when the worker has not created the table yet. */
  trips: number | null;
  lastSavedAt: string | null;
  error: string | null;
}

/** A pg error message, minus anything shaped like a connection string.
 * The messages themselves name hosts and users, never passwords; this is
 * belt and braces for a page whose rule is presence only, never values. */
function safeMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection string]").slice(0, 200);
}

export async function loadDbState(): Promise<DbState> {
  const db = getDb();
  const empty: DbState = { configured: false, reachable: false, pingMs: null, trips: null, lastSavedAt: null, error: null };
  if (!db) return empty;
  const startedAt = Date.now();
  try {
    await db.query("select 1");
  } catch (e) {
    return { ...empty, configured: true, error: safeMessage(e) };
  }
  const pingMs = Date.now() - startedAt;
  try {
    const exists = await db.query<{ t: string | null }>("select to_regclass('public.trips')::text as t");
    if (!exists.rows[0]?.t) return { ...empty, configured: true, reachable: true, pingMs };
    const { rows } = await db.query<{ n: string; last: Date | null }>(
      "select count(*)::text as n, max(finished_at) as last from trips"
    );
    return {
      configured: true,
      reachable: true,
      pingMs,
      trips: Number(rows[0]?.n ?? 0),
      lastSavedAt: rows[0]?.last ? new Date(rows[0].last).toISOString() : null,
      error: null,
    };
  } catch (e) {
    return { ...empty, configured: true, reachable: true, pingMs, error: safeMessage(e) };
  }
}
