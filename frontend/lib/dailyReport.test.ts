// Run: npm run test:daily-report

import assert from "node:assert/strict";
import { buildDailyReport } from "./dailyReport";
import type { AdminTrip } from "./tripsQuery";

const trip = (over: Partial<AdminTrip>): AdminTrip => ({
  id: "t",
  kind: "generate",
  status: "done",
  testMode: false,
  finishedAt: "2026-10-14T10:00:00Z",
  language: "en",
  destinations: ["Rome"],
  dayCount: 3,
  partySize: 2,
  costUsd: 0.4,
  totalMs: 50_000,
  passed: true,
  defects: 0,
  warnings: 0,
  groundedPercent: 80,
  defectDetails: [],
  signedIn: false,
  error: null,
  ...over,
});

const now = new Date("2026-10-15T06:00:00Z");
const report = buildDailyReport(
  [
    trip({ id: "a" }),
    trip({ id: "b", passed: false, defects: 2, defectDetails: ["day 2 has no lunch", "day 3 has no lunch"], totalMs: 70_000, costUsd: 0.6 }),
    trip({ id: "c", status: "error", passed: null, error: "<script>x</script>", destinations: ["<b>Paris</b>"], totalMs: null, costUsd: null }),
    trip({ id: "d", kind: "refine" }),
    trip({ id: "e", kind: "edit", costUsd: 0 }),
    trip({ id: "f", testMode: true, costUsd: 9 }),
  ],
  "https://yourdecide.com/",
  now
);

assert.equal(report.subject, "decide 2026-10-15: 4 trips, 67% passed, 1 failed");
assert.match(report.text, /Trips: 4 \(1 pushbacks\)/);
assert.match(report.text, /Hand edits: 1/);
assert.match(report.text, /Median time: 50s/, "median of 50, 50, 70");
assert.match(report.text, /Cost: \$1\.40 total, \$0\.47 average/, "test runs and edits are not in the cost");
assert.match(report.text, /Test runs \(not counted\): 1/);
assert.match(report.text, /2x day N has no lunch/, "the same problem on different days counts once per kind");
assert.match(report.text, /https:\/\/yourdecide\.com\/trip\/c/);
assert.ok(!report.html.includes("<script>"), "traveller input is escaped");
assert.ok(!report.html.includes("<b>Paris"), "city names too");
assert.ok(report.html.includes("&lt;b&gt;Paris"));

const empty = buildDailyReport([], "https://yourdecide.com", now);
assert.equal(empty.subject, "decide 2026-10-15: no trips yesterday");
assert.match(empty.text, /Passed quality: - \(0 of 0\)/);

console.log("dailyReport: all assertions passed");
