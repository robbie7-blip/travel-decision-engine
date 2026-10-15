// The site's two questions of the trips table (worker/src/db.ts owns the
// schema and the writes).
//
//   - "My trips": a signed-in traveller's finished trips, on any device.
//   - The admin list: recent trips with their cost, time and quality.
//
// No path aliases and no runtime imports beyond types, deliberately: the
// worker's Postgres suite (worker/src/db.test.ts) imports this file and
// runs both queries against a real database, since the worker is the side
// CI gives a Postgres to.

/** Anything with node-postgres's query(): a Pool or a client. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface MyTrip {
  jobId: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  language: "en" | "bg";
  finishedAt: string;
}

/** The newest version of each trip only: a trip some later trip of the
 * same account `replaces` (a pushback, a retry) is left out, so three
 * rounds of pushback are one line, not four. Expired rows are left out
 * even before the sweep removes them. */
export const MY_TRIPS_SQL = `
  select t.id, t.destinations, to_char(t.start_date, 'YYYY-MM-DD') as start_date,
         to_char(t.end_date, 'YYYY-MM-DD') as end_date, t.language, t.finished_at
  from trips t
  where t.owner_email = $1 and t.status = 'done' and t.expires_at > now()
    and not exists (
      select 1 from trips r
      where r.replaces = t.id and r.owner_email = t.owner_email and r.status = 'done'
    )
  order by t.finished_at desc
  limit $2`;

export const MY_TRIPS_LIMIT = 50;

export async function listMyTrips(db: Queryable, email: string, limit = MY_TRIPS_LIMIT): Promise<MyTrip[]> {
  const owner = email.trim().toLowerCase();
  if (!owner) return [];
  const { rows } = await db.query<{
    id: string;
    destinations: string[];
    start_date: string | null;
    end_date: string | null;
    language: string;
    finished_at: Date;
  }>(MY_TRIPS_SQL, [owner, limit]);
  return rows.map((r) => ({
    jobId: r.id,
    destinations: r.destinations,
    startDate: r.start_date ?? "",
    endDate: r.end_date ?? "",
    language: r.language === "bg" ? "bg" : "en",
    finishedAt: new Date(r.finished_at).toISOString(),
  }));
}

export interface AdminTrip {
  id: string;
  kind: "generate" | "refine" | "edit";
  status: "done" | "error";
  testMode: boolean;
  finishedAt: string;
  language: string;
  destinations: string[];
  dayCount: number | null;
  partySize: number | null;
  costUsd: number | null;
  totalMs: number | null;
  passed: boolean | null;
  defects: number | null;
  warnings: number | null;
  groundedPercent: number | null;
  /** The defect lines, for reading the list without opening each trip. */
  defectDetails: string[];
  /** Whether a signed-in account asked for it. Never WHICH account: the
   * admin list is for the product's health, not for reading people. */
  signedIn: boolean;
  error: string | null;
}

export const ADMIN_TRIPS_SQL = `
  select id, kind, status, test_mode, finished_at, language, destinations, day_count, party_size,
         cost_usd::float8 as cost_usd,
         (timings->>'totalMs')::float8 as total_ms,
         (quality->>'passed')::boolean as passed,
         (quality->>'defectCount')::int as defects,
         (quality->>'warningCount')::int as warnings,
         (quality->>'groundedPercent')::float8 as grounded,
         coalesce((
           select jsonb_agg(f->>'detail') from jsonb_array_elements(
             case when jsonb_typeof(quality->'findings') = 'array' then quality->'findings' else '[]'::jsonb end
           ) f where f->>'severity' = 'defect'
         ), '[]'::jsonb) as defect_details,
         owner_email is not null as signed_in,
         error
  from trips
  where ($2::boolean or not test_mode)
    and ($3::int is null or finished_at > now() - make_interval(hours => $3::int))
  order by finished_at desc
  limit $1`;

/** sinceHours narrows it to the last N hours (the daily report). */
export async function listAdminTrips(
  db: Queryable,
  limit = 100,
  includeTests = true,
  sinceHours: number | null = null
): Promise<AdminTrip[]> {
  const { rows } = await db.query<{
    id: string;
    kind: string;
    status: string;
    test_mode: boolean;
    finished_at: Date;
    language: string;
    destinations: string[];
    day_count: number | null;
    party_size: number | null;
    cost_usd: number | null;
    total_ms: number | null;
    passed: boolean | null;
    defects: number | null;
    warnings: number | null;
    grounded: number | null;
    defect_details: unknown;
    signed_in: boolean;
    error: string | null;
  }>(ADMIN_TRIPS_SQL, [limit, includeTests, sinceHours]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === "refine" || r.kind === "edit" ? r.kind : "generate",
    status: r.status === "done" ? "done" : "error",
    testMode: r.test_mode,
    finishedAt: new Date(r.finished_at).toISOString(),
    language: r.language,
    destinations: r.destinations,
    dayCount: r.day_count,
    partySize: r.party_size,
    costUsd: r.cost_usd,
    totalMs: r.total_ms,
    passed: r.passed,
    defects: r.defects,
    warnings: r.warnings,
    groundedPercent: r.grounded,
    defectDetails: Array.isArray(r.defect_details)
      ? r.defect_details.filter((d): d is string => typeof d === "string")
      : [],
    signedIn: r.signed_in,
    error: r.error,
  }));
}

export interface AdminSummary {
  trips: number;
  failed: number;
  passed: number;
  avgCostUsd: number | null;
  medianMs: number | null;
  /** Kind split, since a pushback and a new trip cost very differently. */
  refines: number;
}

/** The last seven days at a glance, real traffic only (no test mode). */
export const ADMIN_SUMMARY_SQL = `
  select count(*)::int as trips,
         count(*) filter (where status = 'error')::int as failed,
         count(*) filter (where (quality->>'passed')::boolean)::int as passed,
         avg(cost_usd)::float8 as avg_cost,
         percentile_cont(0.5) within group (order by (timings->>'totalMs')::float8) as median_ms,
         count(*) filter (where kind = 'refine')::int as refines
  from trips
  where finished_at > now() - interval '7 days' and not test_mode and kind <> 'edit'`;

export async function adminSummary(db: Queryable): Promise<AdminSummary> {
  const { rows } = await db.query<{
    trips: number;
    failed: number;
    passed: number;
    avg_cost: number | null;
    median_ms: number | null;
    refines: number;
  }>(ADMIN_SUMMARY_SQL);
  const r = rows[0];
  return {
    trips: r?.trips ?? 0,
    failed: r?.failed ?? 0,
    passed: r?.passed ?? 0,
    avgCostUsd: r?.avg_cost ?? null,
    medianMs: r?.median_ms ?? null,
    refines: r?.refines ?? 0,
  };
}

/** A hand-edited copy of a stored trip (/api/trip-edit), as its own row.
 *
 * Copied from the source row rather than built here, so the brief, the
 * dates and the test flag are the ones the worker stored. The model's
 * quality report and timings are left behind: they describe the trip
 * before the edits, and the admin list should not credit a hand-edited
 * plan with checks it never had. Nothing happens when the source row is
 * missing (a trip from before the archive existed). */
export const SAVE_EDITED_TRIP_SQL = `
  insert into trips (id, kind, status, test_mode, created_at, finished_at, expires_at, language,
    destinations, start_date, end_date, day_count, party_size, brief, itinerary, quality, timings,
    cost_usd, error, owner_email, replaces)
  select $1, 'edit', 'done', test_mode, now(), now(), $2, language,
    destinations, start_date, end_date, $3, party_size, brief, $4::jsonb, null, null,
    0, null, $5, id
  from trips where id = $6
  on conflict (id) do nothing`;

export async function saveEditedTrip(
  db: Queryable,
  row: { id: string; sourceId: string; expiresAt: Date; dayCount: number; itinerary: unknown; ownerEmail: string | null }
): Promise<void> {
  await db.query(SAVE_EDITED_TRIP_SQL, [
    row.id,
    row.expiresAt,
    row.dayCount,
    JSON.stringify(row.itinerary),
    row.ownerEmail ? row.ownerEmail.trim().toLowerCase() : null,
    row.sourceId,
  ]);
}
