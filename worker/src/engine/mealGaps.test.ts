// Run: npm run test:meal-gaps

import { addMealPlaceholders, removeUnfilledPlaceholders } from "./mealGaps";
import { check, finish, heading, section } from "../testutil";
import type { Itinerary, ItineraryItem } from "../types";
import type { SkeletonDay } from "./twoPhase";

heading("filling a meal the plan owes");

const it = (over: Partial<ItineraryItem>): ItineraryItem =>
  ({ time: "10:00", type: "activity", title: "x", location: "Trastevere, Rome", cost_estimate_eur: 0, reasoning: "", source_confidence: "inferred", ...over }) as ItineraryItem;
const plan = (day: number, meals?: string[]) => ({ day, meals }) as unknown as SkeletonDay;
const brief = { language: "en", party_size: 2 } as const;

section("a missing breakfast gets a placeholder before the day starts, near the bed");
{
  const t = {
    days: [
      { day: 1, date: "2027-01-15", items: [it({ type: "lodging", title: "Hotel", location: "Monti, Rome", time: "21:00" })] },
      { day: 2, date: "2027-01-16", items: [it({ time: "10:00" }), it({ type: "meal", title: "Lunch", time: "13:00" }), it({ type: "meal", title: "Dinner", time: "20:00" })] },
    ],
  } as unknown as Itinerary;
  const added = addMealPlaceholders(t, [plan(2, ["breakfast", "lunch", "dinner"])], brief);
  check("one placeholder, for breakfast", added.length === 1 && added[0].title === "Breakfast", JSON.stringify(added.map((a) => a.title)));
  check("an hour before the 10:00 start, at most 8:30", added[0].time === "08:30", added[0].time);
  check("near last night's accommodation", added[0].location === "Monti, Rome", added[0].location);
  check("priced as an estimate for the party", added[0].cost_estimate_eur === 20 && added[0].source_confidence === "inferred");
}

section("no breakfast squeezed in before an early flight");
{
  const t = { days: [{ day: 3, date: "2027-01-17", items: [it({ type: "transport", title: "Flight home", time: "06:40" }), it({ time: "10:00" })] }] } as unknown as Itinerary;
  check("skipped", addMealPlaceholders(t, [plan(3, ["breakfast"])], brief).length === 0);
}

section("only the meals the plan says the day owes");
{
  const t = { days: [{ day: 1, date: "2027-01-15", items: [it({ time: "15:00" })] }] } as unknown as Itinerary;
  const added = addMealPlaceholders(t, [plan(1, ["dinner"])], brief);
  check("dinner only, at 19:30", added.length === 1 && added[0].title === "Dinner" && added[0].time === "19:30");
  check("a day with no plan gets nothing", addMealPlaceholders({ days: [{ day: 9, date: "x", items: [it({})] }] } as unknown as Itinerary, [], brief).length === 0);
}

section("in Bulgarian on a Bulgarian trip");
{
  const t = { days: [{ day: 1, date: "2027-01-15", items: [it({ time: "15:00" })] }] } as unknown as Itinerary;
  check("Вечеря", addMealPlaceholders(t, [plan(1, ["dinner"])], { language: "bg", party_size: 1 })[0]?.title === "Вечеря");
}

section("what Places could not name is taken out again");
{
  const t = { days: [{ day: 1, date: "2027-01-15", items: [it({ time: "15:00" })] }] } as unknown as Itinerary;
  const added = addMealPlaceholders(t, [plan(1, ["lunch", "dinner"])], brief);
  added[0].venue_name = "Da Enzo al 29";
  const kept = removeUnfilledPlaceholders(t, added);
  check("the named one stays, the other goes", kept === 1 && t.days[0].items.length === 2 && t.days[0].items.some((i) => i.venue_name === "Da Enzo al 29"));
}

finish();
