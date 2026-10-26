// Run: npm run test:trip-cities

import { citiesInPlan } from "./tripCities";
import { check, finish, heading, section } from "./testutil";
import type { ItineraryDay } from "./types";

heading("the cities a plan actually goes to");

const day = (...lines: [string, string][]): ItineraryDay =>
  ({ day: 1, date: "2027-01-15", feasibility_flag: null, items: lines.map(([title, location]) => ({ title, location })) }) as ItineraryDay;

section("a city pushed out of the plan leaves the header");
{
  const days = [
    day(["Breakfast", "Friedrichshafen city center"], ["Drive to Vaduz", "Vaduz, Liechtenstein"]),
    day(["Neuschwanstein Castle tour", "Schwangau"], ["Dinner", "Friedrichshafen"]),
  ];
  const kept = citiesInPlan(["Friedrichshafen", "Munich", "Vaduz"], days);
  check("Munich is gone, the rest stay in order", JSON.stringify(kept) === JSON.stringify(["Friedrichshafen", "Vaduz"]), JSON.stringify(kept));
}

section("nothing taken away when it cannot tell");
{
  const days = [day(["Coffee at Café Central", "Herrengasse 14"])];
  check("days naming no city keep the request", citiesInPlan(["Vienna", "Salzburg"], days)?.length === 2);
  check("one city is always itself", citiesInPlan(["Rome"], [day(["Pantheon", "Piazza della Rotonda"])])?.[0] === "Rome");
  check("no days yet keeps the request", citiesInPlan(["Rome", "Florence"], [])?.length === 2);
}

section("names match as words, accents and case aside");
{
  const days = [day(["Walk", "Zürich old town"], ["Lunch", "near the Romeo bar"])];
  const kept = citiesInPlan(["Zurich", "Rome"], days);
  check("Zurich matches Zürich, Rome does not match Romeo", JSON.stringify(kept) === JSON.stringify(["Zurich"]), JSON.stringify(kept));
  check("a ', Country' in the brief is ignored", citiesInPlan(["Paris, United States", "Dallas"], [day(["Walk", "Paris downtown"])])?.[0] === "Paris, United States");
}

finish();
