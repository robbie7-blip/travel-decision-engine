// The arrival/departure time picker's options and formatting.
//
// The picker replaced two free-text inputs placeholdered "e.g. 8pm, or
// 'evening'". Two things have to stay true for that to be an improvement
// rather than a trade: a value that was already in the field must still be
// shown (a time typed before this existed, or one a flight import wrote),
// and "evening" must still be sayable, because TripBriefInput's own comment
// documents it and the prompt handles it.
//
// Run: npm run test:time-options

import {
  clockSlots,
  formatClockTime,
  formatTimeValue,
  isClockTime,
  matchesTimeQuery,
  normalizeTimeValue,
  TIMES_OF_DAY,
  TIME_STEP_MINUTES,
} from "./timeOptions";
import { check, finish, heading, section } from "./testutil";

heading("arrival and departure times");

function main() {
  {
    section("the slots");

    const slots = clockSlots();
    check("cover a whole day at the declared step", slots.length === (24 * 60) / TIME_STEP_MINUTES, String(slots.length));
    check("start at midnight", slots[0] === "00:00");
    check("end at the last half hour", slots[slots.length - 1] === "23:30");
    check("are all canonical", slots.every(isClockTime));
    check("are strictly increasing", slots.every((slot, i) => i === 0 || slot > slots[i - 1]));
    check("no duplicates", new Set(slots).size === slots.length);
    check("a finer step still works", clockSlots(15).length === 96);
  }

  {
    section("what counts as a clock time");

    for (const good of ["00:00", "09:30", "13:45", "23:59"]) {
      check(`${good} is a clock time`, isClockTime(good));
    }
    // Zero-padded, 24-hour, and nothing else - this is the shape the prompt
    // and the engine's own hour arithmetic already expect.
    for (const bad of ["9:30", "24:00", "23:60", "8pm", "20:00:00", "", "evening", "２０:００"]) {
      check(`${JSON.stringify(bad)} is not`, isClockTime(bad) === false);
    }
  }

  {
    section("formatting follows the locale, like the calendar beside it");

    check("en-GB stays 24-hour", formatClockTime("20:00", "en") === "20:00", formatClockTime("20:00", "en"));
    check("  midnight too", formatClockTime("00:00", "en") === "00:00", formatClockTime("00:00", "en"));
    check("bg is 24-hour as well", formatClockTime("20:00", "bg").includes("20"), formatClockTime("20:00", "bg"));
    // Both locales must produce something, for every slot - a blank option
    // is an unclickable row.
    for (const slot of clockSlots()) {
      check(`${slot} renders in both languages`, formatClockTime(slot, "en").length > 0 && formatClockTime(slot, "bg").length > 0);
    }
  }

  {
    section("the times of day, which a strict clock would have removed");

    check("there are several", TIMES_OF_DAY.length >= 5);
    check("values are English", TIMES_OF_DAY.every((o) => /^[a-z ]+$/.test(o.value)));
    check("every one has a Bulgarian label", TIMES_OF_DAY.every((o) => o.bg.length > 0));
    check("no duplicate values", new Set(TIMES_OF_DAY.map((o) => o.value)).size === TIMES_OF_DAY.length);

    // The one the documentation names.
    check("evening is on the list", TIMES_OF_DAY.some((o) => o.value === "evening"));
    check("  and displays translated", formatTimeValue("evening", "bg") === "вечерта", formatTimeValue("evening", "bg"));
    check("  while its value stays English", formatTimeValue("evening", "en") === "evening");
  }

  {
    section("a value the picker did not write is still shown");

    // The case that decides whether this is an improvement or a trade. A
    // control that blanks what it does not recognise would throw away a
    // time a traveller had already entered, or one flight import wrote.
    for (const foreign of ["8pm", "late evening-ish", "around noon", "след обяд", "whenever"]) {
      check(`${JSON.stringify(foreign)} is displayed as-is`, formatTimeValue(foreign, "en") === foreign);
      check(`  and in bg too`, formatTimeValue(foreign, "bg") === foreign);
    }
    check("an empty value is empty, not a stray label", formatTimeValue("", "en") === "");
    check("  and whitespace is too", formatTimeValue("   ", "en") === "");
    check("a recognised value is trimmed", formatTimeValue(" 20:00 ", "en") === "20:00");
    check("  and matched case-insensitively", formatTimeValue("Evening", "en") === "evening");
  }

  {
    section("normalizing something typed elsewhere");

    check("a canonical time passes through", normalizeTimeValue("20:00") === "20:00");
    check("a single-digit hour is padded", normalizeTimeValue("9:30") === "09:30");
    check("a bare hour becomes the hour", normalizeTimeValue("20") === "20:00");
    check("a dot separator works", normalizeTimeValue("08.30") === "08:30");

    check("8pm", normalizeTimeValue("8pm") === "20:00");
    check("8 PM", normalizeTimeValue("8 PM") === "20:00");
    check("8:30pm", normalizeTimeValue("8:30pm") === "20:30");
    check("12am is midnight", normalizeTimeValue("12am") === "00:00");
    check("12pm is midday", normalizeTimeValue("12pm") === "12:00");
    check("a time of day survives", normalizeTimeValue("evening") === "evening");
    check("  case-insensitively", normalizeTimeValue("Evening") === "evening");

    // Null rather than a guess. Getting a departure time wrong moves a
    // whole last day, so "no single unambiguous reading" has to mean no.
    for (const ambiguous of ["", "   ", "whenever", "morning-ish", "13pm", "25", "10:70", "8pm-ish", "half eight"]) {
      check(`${JSON.stringify(ambiguous)} is refused`, normalizeTimeValue(ambiguous) === null, String(normalizeTimeValue(ambiguous)));
    }

    // Whatever it produces must be something the picker can then display
    // and the prompt can read.
    for (const input of ["8pm", "9:30", "20", "08.30", "12am", "evening"]) {
      const normalized = normalizeTimeValue(input);
      check(
        `${input} normalizes to something usable`,
        normalized !== null && (isClockTime(normalized) || TIMES_OF_DAY.some((o) => o.value === normalized)),
        String(normalized)
      );
      // ...and round-trips through the formatter without becoming blank.
      check(`  and formats`, formatTimeValue(normalized ?? "", "en").length > 0);
    }
  }

  section("typing filters the clock, because 48 stacked slots is not a picker");

  {
    // The list was one column of 48 half-hour slots - "a huge dropdown to
    // choose from which isn't really UX friendly". It is a four-column grid
    // now AND it filters as you type, which is the faster of the two for
    // the only person who uses this field: somebody reading a time off a
    // booking in front of them.
    //
    // Digits match loosely on purpose, because "9", "930" and "9:30" are
    // the three ways that time gets read out loud.
    const matching = (q: string) => clockSlots().filter((s) => matchesTimeQuery(s, q));

    check("an empty query keeps everything", matching("").length === clockSlots().length);
    check("a blank query keeps everything", matching("   ").length === clockSlots().length);

    check('"9" finds 09:00 and 09:30', JSON.stringify(matching("9")) === '["09:00","09:30"]', JSON.stringify(matching("9")));
    check('"09" finds the same two', JSON.stringify(matching("09")) === '["09:00","09:30"]', JSON.stringify(matching("09")));
    check('"16" finds 16:00 and 16:30', JSON.stringify(matching("16")) === '["16:00","16:30"]', JSON.stringify(matching("16")));
    check('"930" finds exactly 09:30', JSON.stringify(matching("930")) === '["09:30"]', JSON.stringify(matching("930")));
    check('"9:30" finds exactly 09:30', JSON.stringify(matching("9:30")) === '["09:30"]', JSON.stringify(matching("9:30")));
    check('"0930" finds exactly 09:30', JSON.stringify(matching("0930")) === '["09:30"]', JSON.stringify(matching("0930")));
    check('"1" finds the 1x hours and 01:00', matching("1").length > 2, String(matching("1").length));
    check('"23:30" finds the last slot', JSON.stringify(matching("23:30")) === '["23:30"]', JSON.stringify(matching("23:30")));

    // 24:00 does not exist and 99 is not a time - an empty list is the
    // honest answer, and the popover says so rather than showing nothing
    // with no explanation.
    check('"25" finds nothing', matching("25").length === 0, JSON.stringify(matching("25")));
    check('"99" finds nothing', matching("99").length === 0);

    // A word filters the times of day instead, and must not accidentally
    // match a clock slot.
    for (const option of TIMES_OF_DAY) {
      check(
        `"${option.value}" matches itself`,
        matchesTimeQuery(option.value, option.value),
        option.value
      );
    }
    check('"even" finds no clock slot', matching("even").length === 0);
    check(
      '"even" does find the evening',
      TIMES_OF_DAY.some((o) => matchesTimeQuery(o.value, "even")),
      TIMES_OF_DAY.map((o) => o.value).join(",")
    );
    check("the match is case-insensitive", matchesTimeQuery("Evening", "EVEN"));
  }

  finish();
}

main();
