// The rental car line: found, priced from the search, added when missing.
//
// Run: npm run test:rental-car

import { applyRentalCar, carClassFor, findRentalLine, readRentalReply, rentalDays, rentalUserMessage } from "./rentalCar";
import { check, finish, heading, section } from "../testutil";
import type { Itinerary, ItineraryItem, TripBriefInput } from "../types";

heading("the rental car");

const brief = {
  destinations: ["Friedrichshafen", "Vaduz"],
  start_date: "2027-01-15",
  end_date: "2027-01-17",
  party_size: 4,
  language: "en",
  transport_preference: "rental_car",
} as TripBriefInput;

const item = (over: Partial<ItineraryItem>): ItineraryItem =>
  ({ time: "10:00", type: "activity", title: "x", location: "Friedrichshafen", cost_estimate_eur: 0, reasoning: "", source_confidence: "inferred", ...over }) as ItineraryItem;

const trip = (...first: ItineraryItem[]): Itinerary =>
  ({ days: [{ day: 1, date: "2027-01-15", feasibility_flag: null, items: first }, { day: 2, date: "2027-01-16", feasibility_flag: null, items: [item({ type: "transport", title: "Drive to Neuschwanstein by rental car", cost_estimate_eur: 40 })] }] }) as unknown as Itinerary;

const quote = { dailyEur: 55, carClass: "mid-size estate", sourceUrl: "https://www.example.com/rental" };

section("the search is asked for a car that fits");
{
  check("4 people: mid-size or estate", carClassFor(4) === "mid-size or estate car");
  check("6 people: a 7-seater", carClassFor(6).startsWith("7-seater"));
  check("2 people: compact", carClassFor(2) === "compact car");
  const msg = rentalUserMessage(brief);
  check("with the place, dates and party", msg.includes("Friedrichshafen") && msg.includes("2027-01-15") && msg.includes("4 people"));
}

section("the search's reply");
{
  check("a real rate", readRentalReply({ daily_eur: 54.6, car_class: "estate", source_url: "https://x.com" }, "c")?.dailyEur === 55);
  check("nothing found is nothing", readRentalReply({ daily_eur: null, car_class: null, source_url: null }, "c") === null);
  check("a misread page is not a price", readRentalReply({ daily_eur: 2, source_url: "https://x.com" }, "c") === null);
  check("no source, no price", readRentalReply({ daily_eur: 50, source_url: "" }, "c") === null);
  check("days are counted inclusively", rentalDays("2027-01-15", "2027-01-17") === 3);
}

section("the plan's own rental line is priced from the search");
{
  const pickup = item({ type: "transport", title: "Pick up the rental car", cost_estimate_eur: 160 });
  const t = trip(item({ type: "transport", title: "Arrive at Friedrichshafen airport", time: "12:00" }), pickup);
  check("found, and the driving legs are not mistaken for it", findRentalLine(t) === pickup);
  check("priced", applyRentalCar(t, brief, quote) === "priced");
  check("3 days at 55", pickup.cost_estimate_eur === 165, String(pickup.cost_estimate_eur));
  check("with its source", pickup.source_urls?.[0] === quote.sourceUrl && pickup.source_confidence === "grounded");
  check("the drive keeps its fuel", t.days[1].items[0].cost_estimate_eur === 40);
}

section("added when the plan forgot it");
{
  const t = trip(item({ type: "transport", title: "Arrive at Friedrichshafen airport", time: "12:00" }), item({ title: "Lunch", time: "13:00" }));
  check("added", applyRentalCar(t, brief, quote) === "added");
  const added = t.days[0].items[1];
  check("right after arriving, at the same time", added.title === "Pick up the rental car" && added.time === "12:00", JSON.stringify(added));
  check("priced for the whole trip", added.cost_estimate_eur === 165);
  const morning = trip(item({ title: "Breakfast", time: "08:30" }));
  applyRentalCar(morning, brief, quote);
  check("first thing when the day does not open with an arrival", morning.days[0].items[0].title === "Pick up the rental car");
  const bg = trip(item({ title: "Закуска", time: "08:30" }));
  applyRentalCar(bg, { ...brief, language: "bg" }, quote);
  check("in Bulgarian on a Bulgarian trip", bg.days[0].items[0].title === "Вземане на колата под наем");
}

section("the arrival is found by time, and Bulgarian drives are not the rental");
{
  const t = trip(item({ title: "Lunch", time: "13:00" }), item({ type: "transport", title: "Arrive at the airport", time: "11:00" }));
  applyRentalCar(t, brief, quote);
  const order = t.days[0].items.map((i) => i.title);
  check("placed right after the 11:00 arrival, not after the first line in the list", order[2] === "Pick up the rental car" && t.days[0].items[2].time === "11:00", JSON.stringify(order));
  const bgDrive = trip(item({ type: "transport", title: "Шофиране до Линдау с кола под наем" }));
  check("a Bulgarian drive is not taken for the rental line", findRentalLine(bgDrive) === null);
}

section("no price found: the plan's estimate stays, nothing invented");
{
  const pickup = item({ type: "transport", title: "Pick up the rental car", cost_estimate_eur: 160 });
  const t = trip(pickup);
  check("estimate kept", applyRentalCar(t, brief, null) === "estimate kept" && pickup.cost_estimate_eur === 160 && pickup.source_confidence === "inferred");
  const none = trip(item({ title: "Breakfast" }));
  check("no line made up without a price", applyRentalCar(none, brief, null) === "none" && none.days[0].items.length === 1);
}

section("only when a rental car was picked");
{
  const t = trip(item({ title: "Breakfast" }));
  check("nothing for other choices", applyRentalCar(t, { ...brief, transport_preference: "public_transit" }, quote) === "none" && t.days[0].items.length === 1);
}

finish();
