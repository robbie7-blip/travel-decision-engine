// What to pack, derived from the trip's own forecast.
//
// The thing this suite is really guarding is the LIST OF INPUTS. The
// tempting version of this feature reads item titles for "beach" and
// "hike", and lib/types.ts says directly above ItineraryItem why that
// cannot work: titles follow the trip's response language, which is the
// reason is_flight and venue_name exist as structured fields at all. A
// Bulgarian itinerary says "плаж". interests and party_composition are
// free text the traveller typed, not a canonical set.
//
// So there is a test below that runs the SAME trip in two languages and
// requires an identical list. If somebody later reaches for a keyword, it
// goes red.
//
// Run: npm run test:packing

import { nightsBetween, packingListFor } from "./packing";
import type { DayWeather, DestinationWeather } from "./weather";
import type { ItineraryDay } from "./types";
import { check, finish, heading, section } from "./testutil";

heading("the packing list");

const day = (over: Partial<DayWeather> = {}): DayWeather => ({
  date: "2027-05-01",
  isForecast: true,
  tempMaxC: 20,
  tempMinC: 14,
  precipitationChance: 5,
  precipitationMm: 0,
  condition: "clear",
  ...over,
});

const weatherOf = (...days: DayWeather[]): DestinationWeather => ({ Rome: days });

const ids = (input: Parameters<typeof packingListFor>[0]) => packingListFor(input).entries.map((e) => e.id);

const mild = { weather: weatherOf(day(), day()), startDate: "2027-05-01", endDate: "2027-05-03" };

section("the three lines with no fact behind them");

{
  const list = ids(mild);
  for (const id of ["walkingShoes", "adapter", "documents"]) {
    check(`${id} is always there`, list.includes(id), list.join(","));
  }
  const reasons = packingListFor(mild).entries.filter((e) => ["walkingShoes", "adapter", "documents"].includes(e.id));
  check("and each says it is unconditional", reasons.every((e) => e.reason.kind === "always"));
}

section("cold");

{
  check("a 13C morning asks for a warm layer", ids({ ...mild, weather: weatherOf(day({ tempMinC: 13 })) }).includes("warmLayer"));
  check("a 14C morning does not", !ids({ ...mild, weather: weatherOf(day({ tempMinC: 14 })) }).includes("warmLayer"));

  const cold = ids({ ...mild, weather: weatherOf(day({ tempMinC: 1, tempMaxC: 6 })) });
  check("3C asks for a winter coat", cold.includes("winterCoat"));
  check("  and not also the lighter layer, which it replaces", !cold.includes("warmLayer"), cold.join(","));
  check("  but not gloves yet", !cold.includes("hatGloves"), cold.join(","));

  const freezing = ids({ ...mild, weather: weatherOf(day({ tempMinC: -4, tempMaxC: 2 })) });
  check("below zero asks for hat and gloves", freezing.includes("hatGloves"));
  check("  and the coat", freezing.includes("winterCoat"));
}

section("hot");

{
  const hot = ids({ ...mild, weather: weatherOf(day({ tempMaxC: 31, tempMinC: 22 })) });
  for (const id of ["sunProtection", "sunHat", "waterBottle"]) {
    check(`31C asks for ${id}`, hot.includes(id), hot.join(","));
  }
  check("20C asks for none of them", !ids({ ...mild, weather: weatherOf(day({ tempMaxC: 20 })) }).some((i) => i.startsWith("sun")));
}

section("rain, counted from whichever field is present");

{
  // A real forecast reports a chance.
  const forecastRain = weatherOf(day({ precipitationChance: 70 }), day({ precipitationChance: 10 }));
  const one = packingListFor({ ...mild, weather: forecastRain });
  check("one wet day asks for a shell", one.entries.some((e) => e.id === "rainShell"));
  check("  but not an umbrella as well", !one.entries.some((e) => e.id === "umbrella"));
  check("  and counts exactly one", one.rainyDays === 1, String(one.rainyDays));

  const two = packingListFor({ ...mild, weather: weatherOf(day({ precipitationChance: 70 }), day({ precipitationChance: 55 })) });
  check("two wet days ask for the umbrella too", two.entries.some((e) => e.id === "umbrella"));

  // THE ONE THAT WOULD HAVE BEEN WRONG. Beyond the forecast horizon
  // lib/weather.ts returns historical averages, which carry millimetres
  // and leave the chance null - reading only the chance reported every
  // trip booked months ahead as dry.
  const historical = packingListFor({
    ...mild,
    weather: weatherOf(
      day({ isForecast: false, precipitationChance: null, precipitationMm: 9 }),
      day({ isForecast: false, precipitationChance: null, precipitationMm: 6 })
    ),
  });
  check("a historical average's millimetres count as rain", historical.rainyDays === 2, String(historical.rainyDays));
  check("  so the shell is still offered", historical.entries.some((e) => e.id === "rainShell"));
  check("  and the panel knows to caveat it", historical.someHistorical === true);

  // A wet condition with no numbers at all.
  const stormy = packingListFor({ ...mild, weather: weatherOf(day({ precipitationChance: null, precipitationMm: null, condition: "thunderstorm" })) });
  check("a thunderstorm counts even with no numbers", stormy.rainyDays === 1, String(stormy.rainyDays));
}

section("snow");

{
  const snowy = ids({ ...mild, weather: weatherOf(day({ condition: "snow", tempMinC: -2, tempMaxC: 1 })) });
  check("snow asks for boots", snowy.includes("snowBoots"), snowy.join(","));
}

section("a day that swings");

{
  check(
    "4C to 20C in one day is a layering problem",
    ids({ ...mild, weather: weatherOf(day({ tempMinC: 4, tempMaxC: 20 })) }).includes("layers")
  );
  check(
    "but two cities being different is not",
    !packingListFor({ ...mild, weather: { Rome: [day({ tempMinC: 18, tempMaxC: 24 })], Oslo: [day({ tempMinC: 4, tempMaxC: 9 })] } })
      .entries.some((e) => e.id === "layers")
  );
}

section("the flight, from a structured field");

{
  const withFlight: ItineraryDay[] = [
    { day: 1, date: "2027-05-01", city: "Rome", theme: "arrive", items: [{ is_flight: true }], feasibility_flag: null } as unknown as ItineraryDay,
  ];
  const list = ids({ ...mild, days: withFlight });
  check("a flight asks for a liquids bag", list.includes("liquidsBag"));
  check("and medication in the cabin", list.includes("medsCarryOn"));

  const noFlight: ItineraryDay[] = [
    { day: 1, date: "2027-05-01", city: "Rome", theme: "arrive", items: [{ is_flight: false }], feasibility_flag: null } as unknown as ItineraryDay,
  ];
  check("a train does not", !ids({ ...mild, days: noFlight }).includes("liquidsBag"));
  check("and neither does no itinerary at all", !ids(mild).includes("liquidsBag"));
}

section("length");

{
  check("nightsBetween counts nights, not days", nightsBetween("2027-05-01", "2027-05-04") === 3);
  check("  and refuses a backwards range", nightsBetween("2027-05-04", "2027-05-01") === 0);
  check("  and junk", nightsBetween("not a date", "2027-05-01") === 0 && nightsBetween(undefined, undefined) === 0);

  check("a week asks about laundry", ids({ ...mild, startDate: "2027-05-01", endDate: "2027-05-08" }).includes("laundryPlan"));
  check("a long weekend does not", !ids(mild).includes("laundryPlan"));
}

section("no forecast at all");

{
  const none = packingListFor({ weather: null, startDate: "2027-05-01", endDate: "2027-05-03" });
  check("hasWeather is false", none.hasWeather === false);
  check("so the panel can stay away", none.coldestC === null && none.hottestC === null);
  check("and nothing weather-shaped is claimed", !none.entries.some((e) => ["rainShell", "warmLayer", "sunHat"].includes(e.id)));
  check("the unconditional three are still there", none.entries.length === 3, String(none.entries.length));

  const empty = packingListFor({ weather: {}, startDate: "2027-05-01", endDate: "2027-05-03" });
  check("an empty forecast object behaves the same", empty.hasWeather === false);
}

section("THE INPUTS: language must not change the answer");

{
  // The same trip, described in two languages. A keyword reader would
  // produce different lists; this must not.
  const base = {
    weather: weatherOf(day({ tempMinC: 12, tempMaxC: 26, precipitationChance: 60 })),
    startDate: "2027-05-01",
    endDate: "2027-05-05",
  };
  const english: ItineraryDay[] = [
    { day: 1, date: "2027-05-01", city: "Rome", theme: "Beach and hiking",
      items: [{ is_flight: true, title: "Flight to Rome" }, { title: "Beach afternoon, then a long hike" }], feasibility_flag: null } as unknown as ItineraryDay,
  ];
  const bulgarian: ItineraryDay[] = [
    { day: 1, date: "2027-05-01", city: "Рим", theme: "Плаж и преходи",
      items: [{ is_flight: true, title: "Полет до Рим" }, { title: "Следобед на плажа, после дълъг преход" }], feasibility_flag: null } as unknown as ItineraryDay,
  ];
  const a = ids({ ...base, days: english });
  const b = ids({ ...base, days: bulgarian });
  check("the two lists are identical", a.join(",") === b.join(","), `${a.join(",")}  vs  ${b.join(",")}`);
  check("and neither invented a beach item", !a.some((i) => /beach|swim|hik/i.test(i)), a.join(","));
}

section("nothing throws on a malformed itinerary");

{
  const nasty = [undefined, null, {}, { items: null }, { items: [null, undefined, {}] }] as unknown as ItineraryDay[];
  let threw = false;
  try {
    packingListFor({ ...mild, days: nasty });
  } catch {
    threw = true;
  }
  check("a half-written day record is survivable", threw === false);
}

finish();
