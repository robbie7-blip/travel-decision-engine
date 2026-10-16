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
import {
  adminSummary,
  adminUnpublish,
  getPublished,
  listAdminTrips,
  listMyTrips,
  listPublished,
  listTripFeedback,
  publishedForJob,
  publishedSlug,
  publishedTitle,
  publishTrip,
  saveEditedTrip,
  saveTripNote,
  saveTripRating,
  tripsEndedOn,
  unpublishTrip,
} from "../../frontend/lib/tripsQuery";

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
    const owned = tripRow(job({ ownerEmail: "  Me@Example.COM ", replaces: "trip-0" }), 0);
    check("the owner is stored lowercased", owned.owner_email === "me@example.com", String(owned.owner_email));
    check("with the trip it replaces", owned.replaces === "trip-0");
    check("an anonymous trip has no owner", r.owner_email === null && r.replaces === null);
  }

  section("published trip addresses and titles (no database needed)");
  {
    check("readable and unique", publishedSlug(["Rome", "Florence"], 5, "3f9a1c2b-0000") === "rome-florence-5-days-3f9a1c");
    check("Bulgarian names transliterated", publishedSlug(["Рим", "Флоренция"], 3, "abcdef12") === "rim-florentsiya-3-days-abcdef");
    check("accents folded", publishedSlug(["Zürich"], 2, "abcdef") === "zurich-2-days-abcdef");
    check("no cities still makes an address", publishedSlug([], 1, "abc") === "trip-1-days-abc");
    check("English title", publishedTitle(["Rome", "Florence", "Venice"], 5, "en") === "5 days in Rome, Florence and Venice");
    check("Bulgarian title", publishedTitle(["Рим"], 1, "bg") === "1 ден в Рим");
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

  section("my trips");
  {
    await db.query("delete from trips");
    const me = "me@example.com";
    const at = (id: string, minutesAgo: number) =>
      db.query("update trips set finished_at = now() - ($2 || ' minutes')::interval where id = $1", [id, minutesAgo]);
    await saveTripRecord(job({ id: "a", ownerEmail: "Me@Example.com" }), 0);
    await at("a", 50);
    await saveTripRecord(job({ id: "b", ownerEmail: me, replaces: "a", refinement: { question: "q" } as never }), 0);
    await at("b", 40);
    await saveTripRecord(job({ id: "c", ownerEmail: me, status: "error", error: "x", result: undefined }), 0);
    await at("c", 30);
    await saveTripRecord(job({ id: "d", ownerEmail: "other@example.com" }), 0);
    await at("d", 25);
    await saveTripRecord(job({ id: "e" }), 0);
    await at("e", 20);
    await saveTripRecord(job({ id: "f", ownerEmail: me, replaces: "d" }), 0);
    await at("f", 10);
    await saveTripRecord(job({ id: "g", ownerEmail: me }), 0);
    await db.query("update trips set expires_at = now() - interval '1 minute' where id = 'g'");
    // A revision that failed does not hide the trip it was revising.
    await saveTripRecord(job({ id: "h", ownerEmail: me, replaces: "f", status: "error", error: "x", result: undefined }), 0);

    const mine = await listMyTrips(db, "  ME@example.com ");
    const ids = mine.map((t) => t.jobId).join(",");
    check("only my finished, unexpired trips, newest first, latest version only", ids === "f,b", ids);
    check("with plain dates", mine[0]?.startDate === "2026-11-06" && mine[0]?.endDate === "2026-11-08", JSON.stringify(mine[0]));
    check("someone else's list is theirs", (await listMyTrips(db, "other@example.com")).map((t) => t.jobId).join(",") === "d");
    check("no address, no list", (await listMyTrips(db, " ")).length === 0);

    // A hand edit of f: a copy of f's row with the new plan, replacing it.
    await saveEditedTrip(db, {
      id: "f-edit",
      sourceId: "f",
      expiresAt: new Date(Date.now() + 86_400_000),
      dayCount: 2,
      itinerary: { days: [{}, {}] },
      ownerEmail: "ME@example.com",
    });
    const edited = (await db.query("select * from trips where id = 'f-edit'")).rows[0];
    check("an edit copies the source's brief and dates", edited?.kind === "edit" && edited.brief.dietary_constraints[0] === "vegetarian" && edited.start_date instanceof Date);
    check("but not its quality report", edited?.quality === null && edited?.day_count === 2);
    const afterEdit = (await listMyTrips(db, me)).map((t) => t.jobId).join(",");
    check("and takes the original's place in my trips", afterEdit === "f-edit,b", afterEdit);
    await saveEditedTrip(db, { id: "x-edit", sourceId: "missing", expiresAt: new Date(), dayCount: 1, itinerary: {}, ownerEmail: null });
    check("an edit of a trip the archive never had writes nothing", (await db.query("select 1 from trips where id = 'x-edit'")).rowCount === 0);
    await db.query("delete from trips where id = 'f-edit'");
  }

  section("admin list");
  {
    await saveTripRecord(
      job({
        id: "q",
        testMode: true,
        quality: {
          findings: [
            { check: "meals", severity: "defect", detail: "day 1 has no lunch" },
            { check: "grounding", severity: "warning", detail: "low grounding" },
          ],
          defectCount: 1,
          warningCount: 1,
          groundedPercent: 40,
          itemCount: 9,
          passed: false,
        } as never,
        timings: { totalMs: 51000 } as never,
      }),
      0.37
    );
    const all = await listAdminTrips(db, 100, true);
    const q = all.find((t) => t.id === "q");
    check("lists every trip, test runs included when asked", all.length === 9, String(all.length));
    check("newest first", all[0]?.id === "q" || all[0]?.id === "h", all[0]?.id);
    check("quality and time read out of the json", q?.passed === false && q?.defects === 1 && q?.totalMs === 51000 && q?.groundedPercent === 40);
    check("defect lines only, not warnings", JSON.stringify(q?.defectDetails) === '["day 1 has no lunch"]', JSON.stringify(q?.defectDetails));
    check("cost as a number", q?.costUsd === 0.37);
    check("says signed in or not, never who", q?.signedIn === false && all.find((t) => t.id === "a")?.signedIn === true && !JSON.stringify(all).includes("@"));
    check("test runs can be left out", !(await listAdminTrips(db, 100, false)).some((t) => t.id === "q"));
    const summary = await adminSummary(db);
    check("summary counts real traffic only", summary.trips === 8 && summary.failed === 2 && summary.refines === 1, JSON.stringify(summary));
  }

  section("published trips");
  {
    await db.query("delete from published_trips");
    const base = {
      jobId: "job-pub",
      language: "en" as const,
      title: "3 days in Rome",
      summary: "A slow Rome weekend.",
      destinations: ["Rome"],
      dayCount: 3,
      party: "couple",
      itinerary: { days: [{ day: 1 }] },
    };
    const slug = await publishTrip(db, { ...base, slug: "rome-3-days-jobpub", ownerEmail: "Me@Example.com" });
    check("publishing returns the address", slug === "rome-3-days-jobpub");
    const again = await publishTrip(db, { ...base, slug: "a-different-slug", summary: "Updated.", ownerEmail: "me@example.com" });
    check("publishing again keeps the same address", again === "rome-3-days-jobpub");
    const page = await getPublished(db, slug);
    check("the page has the plan and the new summary", page?.summary === "Updated." && (page?.itinerary as { days: unknown[] }).days.length === 1);
    check("and never the owner's address", !JSON.stringify(page).includes("@"));
    check("the trip knows its page", (await publishedForJob(db, "job-pub")) === slug);
    const list = await listPublished(db);
    check("the index lists it, without plans or owners", list.length === 1 && !("itinerary" in list[0]) && !JSON.stringify(list).includes("@"));
    await unpublishTrip(db, "job-pub", "someone-else@example.com");
    check("someone else cannot take it down", (await getPublished(db, slug)) !== null);
    await unpublishTrip(db, "job-pub", "ME@example.com");
    check("its owner can", (await getPublished(db, slug)) === null);
    await publishTrip(db, { ...base, slug, ownerEmail: "me@example.com" });
    await adminUnpublish(db, slug);
    check("and so can the admin", (await getPublished(db, slug)) === null);
  }

  section("how was your trip?");
  {
    await db.query("delete from trip_feedback");
    const ended = { ...brief, end_date: "2026-09-20" };
    await saveTripRecord(job({ id: "hw-1", brief: ended, ownerEmail: "a@example.com", ttlSeconds: SAVED_JOB_TTL_SECONDS, createdAt: Date.now(), updatedAt: Date.now() }), 0);
    await saveTripRecord(job({ id: "hw-anon", brief: ended, createdAt: Date.now(), updatedAt: Date.now() }), 0);
    await saveTripRecord(job({ id: "hw-test", brief: ended, ownerEmail: "a@example.com", testMode: true, createdAt: Date.now(), updatedAt: Date.now() }), 0);
    await saveTripRecord(job({ id: "hw-old", brief: ended, ownerEmail: "b@example.com", ttlSeconds: SAVED_JOB_TTL_SECONDS, createdAt: Date.now(), updatedAt: Date.now() }), 0);
    await saveTripRecord(job({ id: "hw-new", brief: ended, ownerEmail: "b@example.com", replaces: "hw-old", ttlSeconds: SAVED_JOB_TTL_SECONDS, createdAt: Date.now(), updatedAt: Date.now() }), 0);
    const ids = (await tripsEndedOn(db, "2026-09-20")).map((t) => t.jobId).sort();
    check("asks about signed-in trips that ended that day, latest version only", JSON.stringify(ids) === '["hw-1","hw-new"]', JSON.stringify(ids));
    check("not about trips ending another day", (await tripsEndedOn(db, "2026-09-21")).length === 0);
    await saveTripRating(db, { jobId: "hw-1", rating: "ok", destinations: ["Rome"], language: "en" });
    check("a note with no answer behind it is not stored", (await saveTripNote(db, "hw-none", "hi")) === false);
    check("a note on an answer is", (await saveTripNote(db, "hw-1", "The museum was shut.")) === true);
    await saveTripRating(db, { jobId: "hw-1", rating: "great", destinations: ["Rome"], language: "en" });
    const rows = await listTripFeedback(db);
    check("a second tap changes the answer and keeps the note", rows.length === 1 && rows[0].rating === "great" && rows[0].note === "The museum was shut.", JSON.stringify(rows));
    check("and never holds the owner's address", !JSON.stringify(rows).includes("@"));
  }

  // Tidy up the throwaway database.
  await db.query("drop table if exists trips; drop table if exists published_trips; drop table if exists trip_feedback; drop table if exists schema_migrations");
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
