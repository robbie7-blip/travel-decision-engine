// Run: npm run test:day-ahead

import assert from "node:assert/strict";

process.env.SESSION_SECRET = "x".repeat(40);
const { dayAheadEmailFor, stopToken, tomorrowIso, verifyStopToken } = require("./dayAhead") as typeof import("./dayAhead");

// Evening in Sofia, still the same day in UTC: tomorrow is Sofia's.
assert.equal(tomorrowIso(new Date("2026-11-06T16:00:00Z")), "2026-11-07");
// Just after midnight in Sofia (22:30 UTC the day before).
assert.equal(tomorrowIso(new Date("2026-11-06T22:30:00Z")), "2026-11-08");
assert.equal(tomorrowIso(new Date("2026-12-31T16:00:00Z")), "2027-01-01");

const token = stopToken("job-1");
assert.ok(verifyStopToken("job-1", token));
assert.equal(verifyStopToken("job-2", token), false, "a token stops only its own trip");
assert.equal(verifyStopToken("job-1", ""), false);
assert.equal(verifyStopToken("job-1", null), false);

const itinerary = {
  days: [
    { day: 1, date: "2026-11-06", items: [{ time: "10:00", type: "activity", title: "x", location: "", cost_estimate_eur: 0, reasoning: "" }] },
    {
      day: 2,
      date: "2026-11-07",
      items: [
        { time: "09:00", type: "activity", title: "Colosseum <tour>", venue_name: "Colosseum", location: "Rome", cost_estimate_eur: 18, reasoning: "", google_maps_url: "https://maps.google.com/?cid=1" },
        { time: "13:00", type: "meal", title: "Lunch", venue_name: "Roscioli", location: "Rome", cost_estimate_eur: 30, reasoning: "" },
        { time: "20:00", type: "activity", title: "Walk", location: "Rome", cost_estimate_eur: 0, reasoning: "", google_maps_url: "javascript:alert(1)" },
      ],
    },
  ],
} as never;

const email = dayAheadEmailFor({
  itinerary,
  date: "2026-11-07",
  destinations: ["Rome"],
  language: "en",
  tripUrl: "https://yourdecide.com/trip/j",
  stopUrl: "https://yourdecide.com/api/trip-reminders/stop?jobId=j&t=abc",
})!;
assert.equal(email.subject, "Tomorrow: day 2 in Rome");
assert.ok(email.html.includes("Colosseum &lt;tour&gt;"), "titles are escaped");
assert.ok(!email.html.includes("<tour>"));
assert.ok(email.html.includes("https://maps.google.com/?cid=1"));
assert.ok(!email.html.includes("javascript:"), "unsafe links are dropped");
assert.ok(email.html.includes("Worth booking tonight:</strong> Colosseum"), "paid named activities are listed");
assert.ok(!/Worth booking tonight:<\/strong>[^<]*Roscioli/.test(email.html), "meals are not tickets");
assert.ok(email.html.includes("getyourguide.com"), "with a ticket link");
assert.ok(email.html.includes("Stop these emails"));

const bg = dayAheadEmailFor({ itinerary, date: "2026-11-07", destinations: ["Рим"], language: "bg", tripUrl: "u", stopUrl: "s" })!;
assert.equal(bg.subject, "Утре: ден 2 в Рим");

assert.equal(dayAheadEmailFor({ itinerary, date: "2026-11-09", destinations: [], language: "en", tripUrl: "u", stopUrl: "s" }), null, "no plan that day, no email");

console.log("dayAhead: all assertions passed");
