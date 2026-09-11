// Tests the two bits of formatting on the finished trip page.
//
// Both of these lived inside components/ItineraryResult.tsx, so nothing
// could import them and nothing tested them. Both were wrong, and both were
// wrong in the same expensive way: the only detector was the owner paying
// for a generation and reading the page.
//
//   - splitIntoSentences split on a capital letter matched as [A-Z], so
//     Bulgarian reasoning - half of what this product generates - never
//     split at all and rendered as one run-on bullet. It also assumed
//     `reasoning` is always a string; it's covered by no quality check and
//     no repair, and reading .split off undefined throws DURING RENDER,
//     which blanks a finished, paid-for itinerary.
//
//   - hoursLineFor picked the opening-hours line by index arithmetic on an
//     assumed Monday-first ordering that the Places API does not guarantee.
//     Off by one there means the page prints a DIFFERENT DAY'S HOURS
//     underneath the green "open on this day" badge.
//
// Run: npm run test:result-format

import { hoursLineFor, splitIntoSentences } from "./resultFormat";
import { check, finish, heading, section } from "./testutil";

heading("trip-page formatting");

/** Google's weekdayDescriptions, Monday-first, each naming its own day. */
const MONDAY_FIRST = [
  "Monday: 9:00 AM - 5:00 PM",
  "Tuesday: 11:00 AM - 10:00 PM",
  "Wednesday: 11:00 AM - 10:00 PM",
  "Thursday: 11:00 AM - 11:00 PM",
  "Friday: 11:00 AM - midnight",
  "Saturday: 10:00 AM - midnight",
  "Sunday: Closed",
];

/** The same seven lines, Sunday-first - what the legacy Places API returns
 * and what the New API documents no guarantee against. */
const SUNDAY_FIRST = [MONDAY_FIRST[6], ...MONDAY_FIRST.slice(0, 6)];

async function main() {
  section("sentence splitting - both alphabets");

  const en = splitIntoSentences(
    "The budget is tight but workable. Accommodation is the biggest line at 90 EUR a night. €400 covers food and transit."
  );
  check("English splits into its three sentences", en.length === 3, JSON.stringify(en));
  check("a sentence starting with a currency symbol still splits", en[2].startsWith("€400"), JSON.stringify(en[2]));

  // The finding. Cyrillic capitals are not in A-Z, so this used to come
  // back as a single 3-sentence bullet on every Bulgarian trip.
  const bg = splitIntoSentences(
    "Бюджетът е достатъчен. Настаняването е най-голямата част. Остават около 400 EUR за храна."
  );
  check("Bulgarian splits into its three sentences", bg.length === 3, JSON.stringify(bg));
  check("and no text is lost in the split", bg.join(" ").length > 80, String(bg.join(" ").length));

  // Greek, to confirm the fix is "any uppercase letter" and not "Latin plus
  // Cyrillic" - the same bug one alphabet over.
  const el = splitIntoSentences("Ο προϋπολογισμός είναι επαρκής. Η διαμονή είναι το μεγαλύτερο έξοδο.");
  check("so does Greek", el.length === 2, JSON.stringify(el));

  section("sentence splitting - what actually arrives");

  // Nothing guarantees reasoning is present. Before the guard, each of
  // these threw inside a client component and blanked the whole trip.
  check("undefined gives an empty list, not a throw", splitIntoSentences(undefined).length === 0);
  check("null gives an empty list", splitIntoSentences(null).length === 0);
  check("an empty string gives an empty list", splitIntoSentences("").length === 0);
  check("whitespace only gives an empty list", splitIntoSentences("   \n  ").length === 0);
  check("a non-string gives an empty list", splitIntoSentences(42 as unknown as string).length === 0);

  // One sentence with no terminator is the common real case for a short
  // reasoning field, and must survive whole.
  const one = splitIntoSentences("Feasible with care");
  check("a single unterminated sentence comes back whole", one.length === 1 && one[0] === "Feasible with care", JSON.stringify(one));

  // Decimals and abbreviations are where a naive splitter mangles text. The
  // lookahead requires an uppercase letter or currency symbol, so neither
  // splits - the point is that the text is never altered, only grouped.
  const decimal = splitIntoSentences("It comes to 1.5 times the stated budget. Trim a night.");
  check("a decimal point is not a sentence end", decimal.length === 2, JSON.stringify(decimal));

  section("opening hours - the line under the green badge");

  // 2026-04-14 is a Tuesday. Monday-first: index 1. Sunday-first: index 2.
  // Index arithmetic gets one of these right and the other wrong; matching
  // the weekday name gets both.
  check(
    "Monday-first array, Tuesday date",
    hoursLineFor(MONDAY_FIRST, "2026-04-14") === "11:00 AM - 10:00 PM",
    String(hoursLineFor(MONDAY_FIRST, "2026-04-14"))
  );
  check(
    "Sunday-first array, same Tuesday date, same answer",
    hoursLineFor(SUNDAY_FIRST, "2026-04-14") === "11:00 AM - 10:00 PM",
    String(hoursLineFor(SUNDAY_FIRST, "2026-04-14"))
  );

  // Sunday is the ordering-sensitive one: last in a Monday-first array,
  // first in a Sunday-first one. 2026-04-12 is a Sunday.
  check("Sunday from a Monday-first array", hoursLineFor(MONDAY_FIRST, "2026-04-12") === "Closed", String(hoursLineFor(MONDAY_FIRST, "2026-04-12")));
  check("Sunday from a Sunday-first array", hoursLineFor(SUNDAY_FIRST, "2026-04-12") === "Closed", String(hoursLineFor(SUNDAY_FIRST, "2026-04-12")));

  // Every weekday, both orderings, against the day the date actually is -
  // the whole point being that the answer does not depend on the ordering.
  const week = ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19"];
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  let allMatch = true;
  for (let i = 0; i < week.length; i++) {
    const expected = MONDAY_FIRST[i].slice(MONDAY_FIRST[i].indexOf(":") + 1).trim();
    if (hoursLineFor(MONDAY_FIRST, week[i]) !== expected) allMatch = false;
    if (hoursLineFor(SUNDAY_FIRST, week[i]) !== expected) allMatch = false;
  }
  check("all seven days resolve the same under either ordering", allMatch, names.join(", "));

  section("opening hours - the times inside the line survive");

  check(
    "only the first colon is treated as the label separator",
    hoursLineFor(["Tuesday: 11:00 AM - 10:00 PM"], "2026-04-14") === "11:00 AM - 10:00 PM"
  );
  check(
    "a two-block day keeps both blocks",
    hoursLineFor(["Tuesday: 9:00 AM - 2:00 PM, 5:00 PM - 11:00 PM"], "2026-04-14") ===
      "9:00 AM - 2:00 PM, 5:00 PM - 11:00 PM"
  );

  section("opening hours - nothing trustworthy to show");

  check("no descriptions at all", hoursLineFor(undefined, "2026-04-14") === null);
  check("an empty array", hoursLineFor([], "2026-04-14") === null);
  check("a null array", hoursLineFor(null, "2026-04-14") === null);
  check("an unparseable date", hoursLineFor(MONDAY_FIRST, "not a date") === null);
  check("a blank line for that day", hoursLineFor(["Tuesday:   "], "2026-04-14") === null);

  // The fallback path: descriptions that name no weekday we recognise
  // (Google returning localized text). An ordering guess still beats
  // showing nothing, so this returns the Monday-first slot rather than
  // null. 2026-04-14 is a Tuesday - Monday-first index 1.
  const localized = ["понеделник: 9:00 - 17:00", "вторник: 11:00 - 22:00", "сряда: 11:00 - 22:00"];
  check(
    "localized descriptions fall back to the documented ordering",
    hoursLineFor(localized, "2026-04-14") === "11:00 - 22:00",
    String(hoursLineFor(localized, "2026-04-14"))
  );

  // A short array (Google returning fewer than seven lines) must not read
  // off the end and produce "undefined".
  check("a short array does not read past its end", hoursLineFor(["Monday: 9:00 AM - 5:00 PM"], "2026-04-19") === null);

  finish();
}

main();
