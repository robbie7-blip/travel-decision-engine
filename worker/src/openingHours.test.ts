// Tests the "is this place actually open when we're sending them" check.
//
// This is the one verification signal that is about whether going is
// possible rather than whether the place is any good, and it is the error a
// traveler cannot recover from: they trusted the plan, crossed a city, and
// found a locked door. It is also fiddly in exactly the ways that don't
// show up until someone is standing outside - a kitchen that closes at
// 02:00 belongs to the previous day, and a Sunday brunch can fall inside a
// Saturday-night period. Hence direct tests rather than trusting a read of
// the code.
//
// Run: npm run test:hours

import { isOpenAt, stripToUnverified, type PlacesApiPlace, type PlacesOpeningPeriod } from "./engine/venueVerification";
import { check, finish, heading, section } from "./testutil";

// Google's day numbering: 0 = Sunday ... 6 = Saturday.
const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

// Real calendar anchors used throughout, so a wrong weekday shows up as a
// failing test rather than a passing one built on the same mistake.
const DATES = {
  sunday: "2027-03-21",
  monday: "2027-03-22",
  tuesday: "2027-03-23",
  friday: "2027-03-26",
  saturday: "2027-03-27",
};

function place(periods: PlacesOpeningPeriod[]): PlacesApiPlace {
  return { regularOpeningHours: { periods } };
}

function period(day: number, openH: number, closeDay: number, closeH: number): PlacesOpeningPeriod {
  return { open: { day, hour: openH, minute: 0 }, close: { day: closeDay, hour: closeH, minute: 0 } };
}

/** Open 11:00–22:00 every day except Monday - the single most common shape
 * for a restaurant, and the one that produces the classic failure. */
const CLOSED_MONDAYS = place(
  [SUN, TUE, WED, THU, FRI, SAT].map((d) => period(d, 11, d, 22))
);

heading("OPENING HOURS - is the venue open when we send them");

section("the classic failure: dinner on the day it's shut");
{
  check(
    "closed-Mondays restaurant is NOT open for Monday dinner",
    isOpenAt(CLOSED_MONDAYS, DATES.monday, "19:30") === false
  );
  check(
    "the same restaurant IS open for Tuesday dinner",
    isOpenAt(CLOSED_MONDAYS, DATES.tuesday, "19:30") === true
  );
  check(
    "and is shut before it opens on a day it does trade",
    isOpenAt(CLOSED_MONDAYS, DATES.tuesday, "08:30") === false
  );
}

section("time-of-day phrases, not just clock times");
{
  check("'evening' resolves inside dinner service", isOpenAt(CLOSED_MONDAYS, DATES.tuesday, "evening") === true);
  check("'morning' is before an 11:00 opening", isOpenAt(CLOSED_MONDAYS, DATES.tuesday, "morning") === false);
  check(
    "'midday' lands after a 12:00 opening rather than before it",
    isOpenAt(place([period(TUE, 12, TUE, 15)]), DATES.tuesday, "midday") === true
  );
  check(
    "Bulgarian 'вечеря' time phrasing resolves too",
    isOpenAt(CLOSED_MONDAYS, DATES.tuesday, "вечерта") === true
  );
}

section("kitchens that run past midnight");
{
  // Friday 18:00 through Saturday 02:00.
  const lateBar = place([period(FRI, 18, SAT, 2)]);
  check("open at 23:00 on the Friday", isOpenAt(lateBar, DATES.friday, "23:00") === true);
  check("open at 01:00 on the Saturday, which belongs to Friday's period",
    isOpenAt(lateBar, DATES.saturday, "01:00") === true);
  check("shut at 04:00 on the Saturday", isOpenAt(lateBar, DATES.saturday, "04:00") === false);
  check("shut at 15:00 on the Friday, before it opens", isOpenAt(lateBar, DATES.friday, "15:00") === false);
}

section("periods that wrap around the end of the week");
{
  // Saturday 20:00 through Sunday 03:00 - the case a naive linear
  // comparison gets wrong, because Sunday is day 0 and sorts *before*
  // Saturday.
  const saturdayNight = place([period(SAT, 20, SUN, 3)]);
  check("open at 22:00 Saturday", isOpenAt(saturdayNight, DATES.saturday, "22:00") === true);
  check(
    "open at 01:00 Sunday, inside the Saturday-night period",
    isOpenAt(saturdayNight, DATES.sunday, "01:00") === true
  );
  check("shut at 12:00 Sunday", isOpenAt(saturdayNight, DATES.sunday, "12:00") === false);
}

section("open 24 hours");
{
  const allHours = { regularOpeningHours: { periods: [{ open: { day: SUN, hour: 0, minute: 0 } }] } };
  check("always open", isOpenAt(allHours, DATES.monday, "03:00") === true);
}

section("unknown is never treated as closed");
{
  // This distinction is the whole reason the function returns
  // boolean|undefined. Parks, viewpoints and plenty of small businesses
  // publish no hours; treating that as "shut" would delete good venues to
  // solve a problem they don't have.
  check("no published hours → undefined", isOpenAt({}, DATES.monday, "19:30") === undefined);
  check("empty period list → undefined", isOpenAt(place([]), DATES.monday, "19:30") === undefined);
  check(
    "no parseable visit time → undefined, not a guessed closure",
    isOpenAt(CLOSED_MONDAYS, DATES.monday, "sometime later") === undefined
  );
  check("missing time → undefined", isOpenAt(CLOSED_MONDAYS, DATES.monday, undefined) === undefined);
  check("unparseable date → undefined", isOpenAt(CLOSED_MONDAYS, "not-a-date", "19:30") === undefined);
  check(
    "a malformed period is skipped, not crashed on",
    isOpenAt(place([{ open: { hour: 9 } }, period(MON, 9, MON, 17)]), DATES.monday, "12:00") === true
  );
}

section("split service, the European lunch/dinner shape");
{
  // 12:00–15:00 and 19:00–23:00, Tuesday.
  const split = place([period(TUE, 12, TUE, 15), period(TUE, 19, TUE, 23)]);
  check("open for lunch", isOpenAt(split, DATES.tuesday, "13:00") === true);
  check("shut in the afternoon gap", isOpenAt(split, DATES.tuesday, "17:00") === false);
  check("open for dinner", isOpenAt(split, DATES.tuesday, "20:00") === true);
  check(
    "an 'afternoon' activity in the gap is correctly flagged shut",
    isOpenAt(split, DATES.tuesday, "afternoon") === false
  );
}

section("boundaries");
{
  const nineToFive = place([period(MON, 9, MON, 17)]);
  check("open exactly at opening time", isOpenAt(nineToFive, DATES.monday, "09:00") === true);
  check("closed exactly at closing time", isOpenAt(nineToFive, DATES.monday, "17:00") === false);
  check("open one minute before closing", isOpenAt(nineToFive, DATES.monday, "16:59") === true);
}


section("an item that fails verification keeps none of the evidence");
{
  // The opening hours are written onto the item BEFORE the reject
  // conditions run, so a venue rejected for a low rating, a closure, or
  // being shut that day used to keep them - and the page renders
  // google_open_on_visit === true as "✓ Open on this day · 7:00 AM – 9:00
  // PM" in the verified colour.
  //
  // Confirmed on a real Rome run: two meals showed that line with no
  // rating and no Maps link, because their names had been stripped for
  // failing the rating bar while their hours survived. The strongest
  // confidence signal in the product, sitting on the lines that earned it
  // least.
  const rejected = {
    type: "meal",
    title: "Breakfast at Faggiani",
    venue_name: "Faggiani",
    location: "Borgo Pio, Rome",
    time: "07:45",
    cost_estimate_eur: 8,
    reasoning: "r",
    source_confidence: "inferred",
    google_rating: 4.1,
    google_rating_count: 900,
    google_price_level: "moderate",
    google_business_status: "operational",
    google_maps_url: "https://maps.google.com/?cid=1",
    google_open_on_visit: true,
    google_opening_hours: ["Monday: 7:00 AM – 9:00 PM"],
    google_minutes_until_close: 800,
  } as unknown as Parameters<typeof stripToUnverified>[0];

  stripToUnverified(rejected);

  check("the name goes", rejected.venue_name === null);
  check("the rating goes", rejected.google_rating === undefined);
  check("the Maps link goes", rejected.google_maps_url === undefined);
  check(
    "the open-on-this-day badge goes",
    rejected.google_open_on_visit === undefined,
    String(rejected.google_open_on_visit)
  );
  check(
    "the opening hours go with it",
    rejected.google_opening_hours === undefined,
    JSON.stringify(rejected.google_opening_hours)
  );
  check("the closing countdown goes too", rejected.google_minutes_until_close === undefined);
}

finish();
