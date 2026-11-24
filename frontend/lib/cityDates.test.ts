// Run: npm run test:city-dates

import { checkCityStays, cityOnDate, evenNights, fitNights, nightsBetween, staysFromNights } from "./cityDates";
import { check, finish, heading, section } from "./testutil";

heading("dates in each place");

section("nights");
{
  check("six nights", nightsBetween("2027-05-01", "2027-05-07") === 6);
  check("backwards is not a trip", nightsBetween("2027-05-07", "2027-05-01") === null);
  check("even split, extra nights first", JSON.stringify(evenNights(2, 5)) === "[3,2]" && JSON.stringify(evenNights(3, 7)) === "[3,2,2]");
  check("fewer nights than places: no split", evenNights(3, 2) === null);
  check("a change comes out of the last place", JSON.stringify(fitNights([4, 1], 2, 6)) === "[4,2]");
  check("too many for the last place: back to even", JSON.stringify(fitNights([6, 1], 2, 6)) === "[3,3]");
  check("a city added: back to even", JSON.stringify(fitNights([3, 3], 3, 6)) === "[2,2,2]");
}

section("the stays");
{
  const stays = staysFromNights(["Rome", "Florence"], "2027-05-01", [3, 3]);
  check("back to back", JSON.stringify(stays) === JSON.stringify([
    { city: "Rome", start_date: "2027-05-01", end_date: "2027-05-04" },
    { city: "Florence", start_date: "2027-05-04", end_date: "2027-05-07" },
  ]));
  check("Rome on the first day", cityOnDate(stays, "2027-05-01") === "Rome");
  check("the travel day is the place they arrive in", cityOnDate(stays, "2027-05-04") === "Florence");
  check("Florence to the end", cityOnDate(stays, "2027-05-07") === "Florence");
  check("outside the trip, nowhere", cityOnDate(stays, "2027-05-09") === null);

  const ok = checkCityStays(stays, ["rome", "florence"], "2027-05-01", "2027-05-07");
  check("sent stays are accepted, spelled as the destinations are", ok.ok && ok.stays[0].city === "rome");
  check("a gap is refused", !checkCityStays([stays[0], { ...stays[1], start_date: "2027-05-05" }], ["Rome", "Florence"], "2027-05-01", "2027-05-07").ok);
  check("short of the last day is refused", !checkCityStays([stays[0], { ...stays[1], end_date: "2027-05-06" }], ["Rome", "Florence"], "2027-05-01", "2027-05-07").ok);
  check("the wrong order is refused", !checkCityStays(stays, ["Florence", "Rome"], "2027-05-01", "2027-05-07").ok);
  check("a missing place is refused", !checkCityStays([stays[0]], ["Rome", "Florence"], "2027-05-01", "2027-05-07").ok);
  check("nonsense is refused", !checkCityStays("Rome", ["Rome", "Florence"], "2027-05-01", "2027-05-07").ok);
}

finish();
