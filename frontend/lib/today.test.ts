// Which part of the trip is happening now.
//
// Three things here would be wrong in ways nobody notices until they are
// standing in a street somewhere:
//
//   - localDateOf must use the LOCAL parts, not toISOString(). At 01:00 in
//     Sofia, toISOString() returns yesterday, so the panel would show the
//     wrong day of the trip to anyone looking late at night or early in
//     the morning - which on a trip is most people.
//   - minutesOfDay must return null for junk, not 0. Midnight is a real
//     time, so folding an unparseable one into 0 files it as already past
//     for the whole day and hides it.
//   - an item with no usable time must stay in "upcoming". It is something
//     to do today without a fixed hour; sorting it into "earlier" buries
//     it until tomorrow.
//
// Run: npm run test:today

import { localDateOf, minutesOfDay, todayOnTrip } from "./today";
import type { ItineraryDay } from "./types";
import { check, finish, heading, section } from "./testutil";

heading("what is happening today");

const item = (time: string | null, title: string) =>
  ({ time, title, type: "activity", location: "Rome", cost_estimate_eur: 0, reasoning: "", source_confidence: "grounded" }) as never;

const trip: ItineraryDay[] = [
  { day: 1, date: "2027-05-01", city: "Rome", theme: "Arrive", feasibility_flag: null,
    items: [item("14:00", "Land"), item("19:30", "Dinner")] } as unknown as ItineraryDay,
  { day: 2, date: "2027-05-02", city: "Rome", theme: "Ancient", feasibility_flag: null,
    items: [item("09:30", "Colosseum"), item("13:00", "Lunch"), item("16:00", "Forum"), item("20:00", "Trastevere")] } as unknown as ItineraryDay,
  { day: 3, date: "2027-05-03", city: "Rome", theme: "Leave", feasibility_flag: null,
    items: [item("11:00", "Fly home")] } as unknown as ItineraryDay,
];

const titles = (items: { title?: string }[]) => items.map((i) => i.title).join(",");

section("the local date, not the UTC one");

{
  // 01:00 on 2 May in a UTC+3 zone is still 2 May locally, but
  // toISOString() would say 1 May. Constructed from local parts so the
  // assertion holds wherever this runs.
  const early = new Date(2027, 4, 2, 1, 15);
  check("01:15 local is still that date", localDateOf(early) === "2027-05-02", localDateOf(early));

  const late = new Date(2027, 4, 2, 23, 45);
  check("23:45 local is too", localDateOf(late) === "2027-05-02", localDateOf(late));

  check("months and days are padded", localDateOf(new Date(2027, 0, 5, 12)) === "2027-01-05", localDateOf(new Date(2027, 0, 5, 12)));
}

section("reading a time");

{
  check("09:30 is 570 minutes in", minutesOfDay("09:30") === 570);
  check("a single-digit hour works", minutesOfDay("9:30") === 570);
  check("midnight is 0, which is a real answer", minutesOfDay("00:00") === 0);
  check("a trailing label is ignored", minutesOfDay("16:00 onwards") === 960);
  for (const junk of [undefined, null, "", "soon", "25:00", "12:99", "noon"]) {
    check(`${JSON.stringify(junk)} is null, not 0`, minutesOfDay(junk as string) === null, String(minutesOfDay(junk as string)));
  }
}

section("mid-trip, mid-afternoon");

{
  // Day 2, 14:00: the Colosseum and lunch have been, the Forum is next.
  const now = todayOnTrip(trip, "2027-05-02", 14 * 60);
  check("it is day 2", now.day?.day === 2, String(now.day?.day));
  check("of 3", now.position === 2 && now.total === 3, `${now.position}/${now.total}`);
  check("two things have been", titles(now.past) === "Colosseum,Lunch", titles(now.past));
  check("and the Forum is next", titles(now.upcoming) === "Forum,Trastevere", titles(now.upcoming));
}

section("the edges of a day");

{
  const dawn = todayOnTrip(trip, "2027-05-02", 0);
  check("before anything, everything is upcoming", dawn.past.length === 0 && dawn.upcoming.length === 4);

  const exact = todayOnTrip(trip, "2027-05-02", 9 * 60 + 30);
  check("an item starting exactly now is upcoming, not past", titles(exact.upcoming).startsWith("Colosseum"), titles(exact.upcoming));

  const midnight = todayOnTrip(trip, "2027-05-02", 23 * 60 + 59);
  check("after everything, nothing is upcoming", midnight.upcoming.length === 0 && midnight.past.length === 4);
}

section("not a trip day");

{
  for (const [label, date] of [["the day before", "2027-04-30"], ["the day after", "2027-05-04"], ["a year later", "2028-05-02"]] as const) {
    const off = todayOnTrip(trip, date, 12 * 60);
    check(`${label} has no day`, off.day === null);
    check("  and nothing to show", off.past.length === 0 && off.upcoming.length === 0);
    check("  but still knows the trip length", off.total === 3, String(off.total));
  }
}

section("an item with no fixed hour");

{
  const loose: ItineraryDay[] = [
    { day: 1, date: "2027-05-01", city: "Rome", theme: "Free", feasibility_flag: null,
      items: [item("09:00", "Breakfast"), item(null, "Pick up the tickets"), item("20:00", "Dinner")] } as unknown as ItineraryDay,
  ];
  const late = todayOnTrip(loose, "2027-05-01", 18 * 60);
  check("it stays in upcoming all day", titles(late.upcoming).includes("Pick up the tickets"), titles(late.upcoming));
  check("  and is not filed as past", !titles(late.past).includes("Pick up the tickets"), titles(late.past));
}

section("nothing throws on a malformed itinerary");

{
  let threw = false;
  try {
    todayOnTrip(undefined, "2027-05-01", 600);
    todayOnTrip([], "2027-05-01", 600);
    todayOnTrip([null, undefined, {}, { date: 7 }, { date: "2027-05-01", items: null }] as unknown as ItineraryDay[], "2027-05-01", 600);
    todayOnTrip([{ date: "2027-05-01", items: [null, undefined] }] as unknown as ItineraryDay[], "2027-05-01", 600);
  } catch {
    threw = true;
  }
  check("half-written records are survivable", threw === false);
}

finish();
