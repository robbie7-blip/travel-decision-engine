// Run: npm run test:how-was-it

import assert from "node:assert/strict";

process.env.SESSION_SECRET = "y".repeat(40);
const { feedbackToken, feedbackUrl, howWasItEmailFor, isRating, verifyFeedbackToken, yesterdayIso } =
  require("./howWasIt") as typeof import("./howWasIt");

assert.equal(yesterdayIso(new Date("2026-11-10T16:00:00Z")), "2026-11-09");
assert.equal(yesterdayIso(new Date("2026-11-09T22:30:00Z")), "2026-11-09", "after midnight in Sofia it is already the next day");
assert.equal(yesterdayIso(new Date("2027-01-01T10:00:00Z")), "2026-12-31");

const token = feedbackToken("job-1");
assert.ok(verifyFeedbackToken("job-1", token));
assert.equal(verifyFeedbackToken("job-2", token), false, "a link answers only for its own trip");
assert.equal(verifyFeedbackToken("job-1", null), false);
assert.ok(isRating("great") && isRating("ok") && isRating("bad"));
assert.equal(isRating("meh"), false);

const url = new URL(feedbackUrl("https://yourdecide.com/", "job-1", "bad"));
assert.equal(url.pathname, "/api/trip-feedback");
assert.equal(url.searchParams.get("r"), "bad");
assert.ok(verifyFeedbackToken("job-1", url.searchParams.get("t")));

const email = howWasItEmailFor({ site: "https://yourdecide.com", jobId: "job-1", destinations: ["Rome", "<b>x</b>"], language: "en" });
assert.equal(email.subject, "How was Rome · <b>x</b>?");
assert.ok(!email.html.includes("<b>x</b>"), "city names are escaped in the body");
assert.equal((email.html.match(/api\/trip-feedback/g) ?? []).length, 3, "three buttons");
const bg = howWasItEmailFor({ site: "https://yourdecide.com", jobId: "job-1", destinations: ["Рим"], language: "bg" });
assert.equal(bg.subject, "Как мина Рим?");

console.log("howWasIt: all assertions passed");
