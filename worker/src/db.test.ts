// The worker's Postgres archive of finished trips, against a real Postgres.
//
// Needs DATABASE_URL pointing at a throwaway database. CI provides one
// (a postgres service on the worker job); locally, any empty database
// will do. It creates the tables itself and drops them at the end.
//
// Run: DATABASE_URL=postgres://... npm run test:db

import { Pool } from "pg";
import { closeDb, deleteExpiredTrips, getDb, migrate, MIGRATIONS, saveTripRecord, tripRow } from "./db";
import { JOB_TTL_SECONDS, SAVED_JOB_TTL_SECONDS, type Job } from "./jobs";
import { check, finish, heading, section } from "./testutil";
import type { TripBriefInput } from "./types";

heading("trips in Postgres");

const brief: TripBriefInput = {
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2026-11-06",
  end_date: "2026-11-08",
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: null,
  pace: "moderate",
  interests: [],
  must_see: ["Il Paiolo Magico (reservation at 8 pm on the 6th)"],
  dietary_constraints: ["vegetarian"],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
};

const job = (over: Partial<Job> = {}): Job => ({
  id: "trip-1",
  status: "done",
  brief,
  createdAt: Date.parse("2026-10-14T10:00:00Z"),
  updatedAt: Date.parse("2026-10-14T10:01:00Z"),
  result: { trip_summary: "s", key_decisions: [], things_to_skip: [], budget_feasibility: {}, days: [{}, {}, {}] } as never,
  ...over,
});

async function main() {
  section("what a row holds (no database needed)");
  {
    const now = Date.parse("2026-10-14T10:01:00Z");
    const r = tripRow(job(), 0.41237, now);
    check("an anonymous trip lives thirty days, like its Redis record", r.expires_at.getTime() === now + JOB_TTL_SECONDS * 1000);
    const saved = tripRow(job({ ttlSeconds: SAVED_JOB_TTL_SECONDS }), 0, now);
    check("a signed-in trip lives as long as its Redis record", saved.expires_at.getTime() === now + SAVED_JOB_TTL_SECONDS * 1000);
    const greedy = tripRow(job({ ttlSeconds: 10 ** 12 }), 0, now);
    check("and never longer, whatever the record asks", greedy.expires_at.getTime() === now + SAVED_JOB_TTL_SECONDS * 1000);
    check("cost rounded to the cent's hundredth", r.cost_usd === 0.4124, String(r.cost_usd));
    check("day count from the itinerary", r.day_count === 3);
    check("kind", r.kind === "generate" && tripRow(job({ refinement: { question: "q" } as never }), 0).kind === "refine");
    const bad = tripRow(job({ brief: { ...brief, start_date: "06/11/2026" } }), 0);
    check("a malformed date is stored as no date, not an error", bad.start_date === null);
  }

  if (!process.env.DATABASE_URL) {
    // Required in CI, which provides one; skipped on a laptop without one,
    // so `npm test` still runs everywhere. Said out loud either way.
    if (process.env.CI) {
      check("DATABASE_URL is set for the database half of this suite", false, "CI must provide a Postgres");
    } else {
      console.log("\n  SKIPPED  the database half: no DATABASE_URL (CI runs it against a real Postgres)\n");
    }
    finish();
    return;
  }

  section("migrations");
  await migrate();
  await closeDb();
  await migrate(); // a second process starting: nothing to apply
  const db = getDb()!;
  const applied = await db.query("select id from schema_migrations order by id");
  check("each step applied exactly once", applied.rowCount === MIGRATIONS.length, String(applied.rowCount));

  section("saving");
  await db.query("delete from trips");
  await saveTripRecord(job(), 0.41);
  let rows = (await db.query("select * from trips")).rows;
  check("a finished trip becomes a row", rows.length === 1);
  check("with its destinations as an array", JSON.stringify(rows[0].destinations) === '["Rome"]');
  check("its dates as dates", rows[0].start_date instanceof Date);
  check("and the private brief kept server-side", rows[0].brief.dietary_constraints[0] === "vegetarian");

  // A retried job writes again: same row, updated, not a second one.
  await saveTripRecord(job({ status: "error", error: "boom", result: undefined }), 0.5);
  rows = (await db.query("select * from trips")).rows;
  check("saving again updates the same row", rows.length === 1 && rows[0].status === "error" && rows[0].error === "boom");

  section("expiry");
  await saveTripRecord(job({ id: "trip-old" }), 0);
  await db.query("update trips set expires_at = now() - interval '1 minute' where id = 'trip-old'");
  const removed = await deleteExpiredTrips();
  const left = (await db.query("select id from trips order by id")).rows.map((r) => r.id);
  check("expired trips are removed", removed === 1 && !left.includes("trip-old"), `${removed} removed, left ${left}`);
  check("current ones stay", left.includes("trip-1"));

  // Tidy up the throwaway database.
  await db.query("drop table if exists trips; drop table if exists schema_migrations");
  await closeDb();

  section("an unreachable database never breaks a trip");
  {
    const real = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
    let threw = false;
    try {
      await saveTripRecord(job({ id: "trip-x" }), 0);
      await deleteExpiredTrips();
    } catch {
      threw = true;
    }
    check("saving and sweeping fail quietly", !threw);
    await closeDb();
    process.env.DATABASE_URL = real;
  }

  // The pool type is imported so the test fails to compile if db.ts ever
  // stops using node-postgres's Pool without this file noticing.
  void Pool;
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
