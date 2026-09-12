// The historical weather average - a figure shown to the traveller as a
// real thing that happened, on a product whose whole premise is that its
// numbers are checkable.
//
// It was inline in app/api/weather/route.ts, where it could not be tested
// without stubbing the network (and where Next.js will not let a route
// module export anything but its handlers), so it had no test at all. Two
// defects, both found by measuring the real calendar rather than by reading:
//
// THE YEARS WERE ALIGNED BY ARRAY INDEX. `dayCount` came from
// `validYears[0].time.length` on the stated assumption that "every valid
// year should have the same number of days for the same start/end month-day
// span". February 29 breaks that. For a trip 2027-02-27 to 2027-03-02 the
// archive returns 4 days for 2026, 2025, 2023 and 2022 and 5 for 2024 - so
// index 2 is 03-01 in 2026 but 02-29 in 2024, and the leap year's February
// 29 weather was averaged into the traveller's MARCH 1 row, with its March
// 1 landing on March 2. One year silently shifted by a day for the rest of
// the range.
//
// AND A MISSING DAY VOTED FOR CLOUDY. The temperatures were filtered with
// `typeof v === "number"`, so a year without data for a day dropped out of
// the average. The conditions were not: `conditionFromWmoCode(undefined)`
// returns "cloudy", so that same year cast a phantom vote in the plurality
// that picks the icon, and enough of them could flip it on their own.
//
// Plus shiftYear itself: Date.UTC rolls February 29 FORWARD, so
// shiftYear("2028-02-29", 1) returned "2027-03-01" and moved the whole
// queried window a day off the trip's own span.
//
// Run: npm run test:weather

import { averageHistoricalYears, shiftYear, type DailyBlock } from "./weather";
import { check, finish, heading, section } from "./testutil";

heading("historical weather average");

/** Every date from a to b inclusive, as the archive would return them. */
function daysInRange(a: string, b: string): string[] {
  const [ay, am, ad] = a.split("-").map(Number);
  const out: string[] = [];
  const d = new Date(Date.UTC(ay, am - 1, ad));
  while (d.toISOString().slice(0, 10) <= b) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** One archive year, with a per-day temperature so misalignment is
 * visible in the output rather than merely possible. */
function year(start: string, end: string, tempByMonthDay: Record<string, number>, code = 0): DailyBlock {
  const time = daysInRange(start, end);
  return {
    time,
    weathercode: time.map(() => code),
    temperature_2m_max: time.map((iso) => tempByMonthDay[iso.slice(5)] ?? 0),
    temperature_2m_min: time.map((iso) => (tempByMonthDay[iso.slice(5)] ?? 0) - 5),
    precipitation_sum: time.map(() => 0),
  };
}

function main() {
  section("shiftYear does not roll February 29 forward");

  {
    check("an ordinary date shifts cleanly", shiftYear("2027-03-02", 1) === "2026-03-02", shiftYear("2027-03-02", 1));
    check("five years back", shiftYear("2027-03-02", 5) === "2022-03-02", shiftYear("2027-03-02", 5));
  }

  {
    // The measured defect: this returned "2027-03-01".
    check("Feb 29 clamps to Feb 28 in a non-leap year", shiftYear("2028-02-29", 1) === "2027-02-28", shiftYear("2028-02-29", 1));
    check("and stays Feb 29 when the target year is a leap year", shiftYear("2028-02-29", 4) === "2024-02-29", shiftYear("2028-02-29", 4));
  }

  {
    // Jan 31 back a year is still Jan 31 - the clamp must only fire when the
    // month actually rolled.
    check("a 31st in a 31-day month is untouched", shiftYear("2027-01-31", 1) === "2026-01-31", shiftYear("2027-01-31", 1));
    check("a 31st in December is untouched", shiftYear("2027-12-31", 2) === "2025-12-31", shiftYear("2027-12-31", 2));
  }

  section("the years are aligned by calendar day, not by index");

  {
    // The exact reproduction. The leap year is one day longer, so under
    // index alignment its 02-29 value (99) landed on the traveller's 03-01.
    const nonLeap = (y: number) =>
      year(`${y}-02-27`, `${y}-03-02`, { "02-27": 10, "02-28": 10, "03-01": 10, "03-02": 10 });
    const leap = year("2024-02-27", "2024-03-02", {
      "02-27": 10,
      "02-28": 10,
      "02-29": 99, // the value that used to leak onto March 1
      "03-01": 10,
      "03-02": 10,
    });
    const rows = averageHistoricalYears([nonLeap(2026), nonLeap(2025), leap, nonLeap(2023), nonLeap(2022)], "2027-02-27", "2027-03-02");

    check("one row per trip day", rows.length === 4, String(rows.length));
    check("the dates are the trip's own", rows.map((r) => r.date).join(",") === "2027-02-27,2027-02-28,2027-03-01,2027-03-02", rows.map((r) => r.date).join(","));
    check(
      "February 29 does not leak into March 1",
      rows[2].tempMaxC === 10,
      `March 1 averaged to ${rows[2].tempMaxC} (99 means the leap day leaked)`
    );
    check("every day averages to the real value", rows.every((r) => r.tempMaxC === 10), JSON.stringify(rows.map((r) => r.tempMaxC)));
  }

  {
    // The trip's own length is authoritative. A historical year longer than
    // the trip must not add a row the traveller has no day for.
    const long = year("2024-02-27", "2024-03-02", { "02-27": 8, "02-28": 8, "02-29": 8, "03-01": 8, "03-02": 8 });
    const rows = averageHistoricalYears([long], "2027-02-27", "2027-03-02");
    check("a longer archive year does not add a day", rows.length === 4, String(rows.length));
    check("and the last row is the trip's last day", rows[3].date === "2027-03-02", rows[3].date);
  }

  {
    // And a shorter one must not drop a day the traveller does have.
    const short = year("2026-03-01", "2026-03-02", { "03-01": 7, "03-02": 7 });
    const rows = averageHistoricalYears([short], "2027-02-27", "2027-03-02");
    check("a shorter archive year still yields every trip day", rows.length === 4, String(rows.length));
    check("the covered days use its data", rows[2].tempMaxC === 7 && rows[3].tempMaxC === 7, JSON.stringify(rows.map((r) => r.tempMaxC)));
    check("the uncovered days fall back rather than misalign", rows[0].tempMaxC === 0 && rows[1].tempMaxC === 0, JSON.stringify(rows.map((r) => r.tempMaxC)));
  }

  {
    // A trip that actually falls on February 29: non-leap years answer for
    // February 28, the nearest real day, rather than contributing nothing.
    const nonLeap = year("2027-02-27", "2027-02-28", { "02-27": 4, "02-28": 6 });
    const rows = averageHistoricalYears([nonLeap], "2028-02-28", "2028-02-29");
    check("a leap-day trip gets both rows", rows.length === 2, String(rows.length));
    check("Feb 29 falls back to Feb 28's data", rows[1].tempMaxC === 6, String(rows[1].tempMaxC));
  }

  section("a year with no data for a day must not vote on the icon");

  {
    // conditionFromWmoCode(undefined) is "cloudy". The conditions were not
    // filtered the way the temperatures were, so a short year voted cloudy
    // for a day it had nothing to say about.
    const sunnyFull = year("2026-03-01", "2026-03-03", { "03-01": 20, "03-02": 20, "03-03": 20 }, 0); // 0 = clear
    const shortYear = year("2025-03-01", "2025-03-01", { "03-01": 20 }, 0);
    const shortYear2 = year("2024-03-01", "2024-03-01", { "03-01": 20 }, 0);
    const rows = averageHistoricalYears([sunnyFull, shortYear, shortYear2], "2027-03-01", "2027-03-03");
    check("a day only one year covers is still that year's condition", rows[2].condition === "clear", rows[2].condition);
    check("and not cloudy by default", rows[2].condition !== "cloudy", rows[2].condition);
    check("the covered day agrees too", rows[0].condition === "clear", rows[0].condition);
  }

  {
    // With genuinely no data for a day, cloudy is the honest fallback - but
    // it must come from having nothing, not from a phantom vote.
    const rows = averageHistoricalYears([year("2026-03-05", "2026-03-05", { "03-05": 12 })], "2027-03-01", "2027-03-01");
    check("a day no year covers reads as cloudy", rows[0].condition === "cloudy", rows[0].condition);
    check("with no temperature invented beyond the neutral default", rows[0].tempMaxC === 0, String(rows[0].tempMaxC));
  }

  section("shapes that must not throw");

  {
    check("no valid years yields no rows", averageHistoricalYears([], "2027-03-01", "2027-03-02").length === 0);
  }

  {
    // end before start would make dayCount negative; Array.from with a
    // negative length is empty, but returning [] deliberately is clearer
    // than relying on that.
    check("end before start yields no rows", averageHistoricalYears([year("2026-03-01", "2026-03-02", {})], "2027-03-05", "2027-03-01").length === 0);
    check("an unparseable range yields no rows", averageHistoricalYears([year("2026-03-01", "2026-03-02", {})], "nope", "also-nope").length === 0);
  }

  {
    const oneDay = averageHistoricalYears([year("2026-03-01", "2026-03-01", { "03-01": 15 })], "2027-03-01", "2027-03-01");
    check("a single-day trip yields one row", oneDay.length === 1, String(oneDay.length));
    check("with its real temperature", oneDay[0].tempMaxC === 15, String(oneDay[0].tempMaxC));
    check("and is marked as not a forecast", oneDay[0].isForecast === false);
  }

  finish();
}

main();
