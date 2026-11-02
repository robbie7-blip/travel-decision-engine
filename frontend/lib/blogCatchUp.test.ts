// When the evening run writes the blog post the morning run missed.
//
// Run: npm run test:blog-catch-up

import { catchUpDay, type AutopilotRunRecord } from "./blogAutopilotRun";
import { check, finish, heading, section } from "./testutil";

heading("the blog's evening catch-up");

const at = (iso: string) => new Date(iso);
const run = (over: Partial<AutopilotRunRecord>): AutopilotRunRecord => ({ startedAt: Date.parse("2026-11-02T06:10:00Z"), scheduled: true, ...over });
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

section("a Monday evening");
{
  const evening = at("2026-11-02T16:05:00Z");
  check("nothing recorded: the post is written now", day(catchUpDay(evening, null)) === "2026-11-02");
  check("published this morning: nothing to do", catchUpDay(evening, run({ finishedAt: Date.parse("2026-11-02T06:13:00Z"), outcome: "published" })) === null);
  check("only a draft: a post is written", day(catchUpDay(evening, run({ finishedAt: Date.parse("2026-11-02T06:13:00Z"), outcome: "draft" }))) === "2026-11-02");
  check("failed: a post is written", day(catchUpDay(evening, run({ finishedAt: Date.parse("2026-11-02T06:13:00Z"), outcome: "failed" }))) === "2026-11-02");
  check("cut off (never finished): a post is written", day(catchUpDay(evening, run({}))) === "2026-11-02");
  check("a run still writing is left alone", catchUpDay(evening, run({ startedAt: Date.parse("2026-11-02T16:02:00Z") })) === null);
  check("last week's published post does not count for today", day(catchUpDay(evening, run({ startedAt: Date.parse("2026-10-29T06:10:00Z"), finishedAt: Date.parse("2026-10-29T06:13:00Z"), outcome: "published" }))) === "2026-11-02");
}

section("other days");
{
  check("Monday morning before 08:00: the morning run's turn", catchUpDay(at("2026-11-02T07:30:00Z"), null) === null);
  check("Tuesday evening still catches Monday", day(catchUpDay(at("2026-11-03T16:05:00Z"), null)) === "2026-11-02");
  check("Wednesday catches Monday too, at the last", day(catchUpDay(at("2026-11-04T16:05:00Z"), null)) === "2026-11-02");
  check("Saturday: Thursday is two days back, still caught", day(catchUpDay(at("2026-11-07T16:05:00Z"), null)) === "2026-11-05");
  check("Sunday: nothing within two days", catchUpDay(at("2026-11-08T16:05:00Z"), null) === null);
}

finish();
