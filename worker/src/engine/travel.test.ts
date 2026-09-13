// Whether the day leaves time to get between its stops.
//
// The check that was missing, and the most common way an AI day plan
// fails: a day-trip destination dropped into the middle of a city day.
// 09:00 at the Colosseum and 09:30 at the Villa d'Este in Tivoli is a
// real pair of places, a real pair of times, and 34 km of Lazio in
// between. Every other gate check passes it - the prices are sourced,
// both venues exist, both are open, there is no unaccounted gap, no
// duplicate. The day is simply not possible.
//
// This suite is also where the thresholds got calibrated, and it earned
// its keep immediately: the example above was first written as the
// Vatican Museums at 09:00 and the Colosseum at 10:00, the case went red,
// and the numbers were right and I was wrong. 4.8 km is about 24 minutes
// across Rome and an hour is plenty. Both readings are kept below - the
// one that sounds impossible and is fine, and the one that is actually
// impossible - because the difference between them IS the check.
//
// Real coordinates throughout, so every distance is checkable against a
// map rather than against my arithmetic.
//
// Run: npm run test:travel

import {
  estimateHop,
  formatLegDistance,
  parseMinuteOfDay,
  straightLineMetres,
  travelLegsFor,
  travelProblemsFor,
  verdictFor,
} from "./travel";
import { check, finish, heading, section } from "../testutil";
import type { ItineraryDay, ItineraryItem } from "../types";

heading("travel time between stops");

// Rome, from a map.
const VATICAN = { lat: 41.9065, lng: 12.4536 };
const COLOSSEUM = { lat: 41.8902, lng: 12.4922 };
const PANTHEON = { lat: 41.8986, lng: 12.4769 };
const TREVI = { lat: 41.9009, lng: 12.4833 };
// ~700 m from the Pantheon: a real short hop.
const NAVONA = { lat: 41.8992, lng: 12.4731 };
// Villa d'Este, Tivoli - 34 km out, a genuine day trip, and exactly the
// thing a model drops into the middle of a Rome day.
const TIVOLI = { lat: 41.9634, lng: 12.7959 };

const stop = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  time: "09:00",
  type: "activity",
  title: "A place",
  location: "Rome",
  cost_estimate_eur: 10,
  reasoning: "r",
  source_confidence: "grounded",
  ...over,
});

const at = (p: { lat: number; lng: number }, time: string, title: string, over: Partial<ItineraryItem> = {}) =>
  stop({ google_lat: p.lat, google_lng: p.lng, time, title, ...over });

const day = (items: ItineraryItem[], n = 1): ItineraryDay => ({
  day: n,
  date: "2027-05-01",
  items,
  feasibility_flag: null,
});

function main() {
  section("distance, against a real map");

  {
    // The Vatican to the Colosseum is about 3.6 km in a straight line.
    const m = straightLineMetres(VATICAN.lat, VATICAN.lng, COLOSSEUM.lat, COLOSSEUM.lng);
    check("Vatican to Colosseum is ~3.6 km", m > 3_300 && m < 3_900, `${Math.round(m)} m`);

    // The Pantheon to the Trevi Fountain is a well-known short walk, ~550 m.
    const short = straightLineMetres(PANTHEON.lat, PANTHEON.lng, TREVI.lat, TREVI.lng);
    check("Pantheon to Trevi is ~550 m", short > 400 && short < 750, `${Math.round(short)} m`);

    check("a point to itself is zero", straightLineMetres(41.9, 12.5, 41.9, 12.5) === 0);
    check("direction does not matter", Math.round(straightLineMetres(41.9, 12.5, 41.89, 12.49)) === Math.round(straightLineMetres(41.89, 12.49, 41.9, 12.5)));
  }

  {
    // The cos(latitude) correction. Without it a degree of longitude is
    // treated as a degree of latitude and a day in the far north measures
    // roughly twice as wide as it is - which would make the scale bar and
    // every leg lie. One degree of longitude is ~111 km at the equator and
    // ~55 km at 60N.
    const equator = straightLineMetres(0, 0, 0, 1);
    const north = straightLineMetres(60, 0, 60, 1);
    check("a degree of longitude is ~111 km at the equator", equator > 110_000 && equator < 112_000, `${Math.round(equator)} m`);
    check("and about half that at 60N", north > 54_000 && north < 57_000, `${Math.round(north)} m`);
  }

  section("the walk, and when it stops being one");

  {
    // 800 m at 80 m/min is 10 minutes.
    const walk = estimateHop(800);
    check("800 m is a walk", walk.mode === "walk", walk.mode);
    check("and takes ~10 min", walk.minutes === 10, String(walk.minutes));

    // Rounded UP: half a minute short is still short.
    check("a partial minute rounds up", estimateHop(810).minutes === 11, String(estimateHop(810).minutes));
    check("a few metres is still a minute, not zero", estimateHop(5).minutes === 1, String(estimateHop(5).minutes));
    check("zero metres is still a minute", estimateHop(0).minutes === 1);

    // Past the limit nobody walks it, whatever the arithmetic says.
    check("2 km is still a walk", estimateHop(2_000).mode === "walk");
    check("2.1 km is not", estimateHop(2_100).mode === "transit", estimateHop(2_100).mode);

    // Transit carries a fixed overhead, because a 6 km hop across a
    // European city really does take ~20 min and almost none of it is
    // spent moving.
    const hop = estimateHop(6_000);
    check("6 km by transit is ~28 min", hop.minutes >= 25 && hop.minutes <= 32, String(hop.minutes));
    check("a short transit hop is not three minutes", estimateHop(2_400).minutes >= 10, String(estimateHop(2_400).minutes));
  }

  {
    // Every estimate must be longer than the crow flies, never shorter -
    // it errs towards "this day is tight" rather than towards telling
    // someone a walk is shorter than it is.
    const legs = travelLegsFor([at(PANTHEON, "10:00", "Pantheon"), at(TREVI, "11:00", "Trevi")]);
    const crow = straightLineMetres(PANTHEON.lat, PANTHEON.lng, TREVI.lat, TREVI.lng);
    check("the leg is longer than the straight line", legs[0].metres > crow, `${legs[0].metres} vs ${Math.round(crow)}`);
    check("but not absurdly so", legs[0].metres < crow * 1.5, String(legs[0].metres));
  }

  section("times");

  {
    check("24-hour time", parseMinuteOfDay("14:30") === 14 * 60 + 30, String(parseMinuteOfDay("14:30")));
    check("a dot separator", parseMinuteOfDay("14.30") === 870);
    check("midnight", parseMinuteOfDay("00:00") === 0);
    check("a time inside a sentence", parseMinuteOfDay("meet at 09:15 sharp") === 555, String(parseMinuteOfDay("meet at 09:15 sharp")));

    // Minutes, not hours. The gate's own parseHour cannot tell
    // 09:00-to-09:15 from 09:00-to-09:59, and the fifteen-minute version is
    // exactly the impossible day this exists to catch.
    check("quarter hours are distinguishable", parseMinuteOfDay("09:15") !== parseMinuteOfDay("09:45"));

    for (const bad of [undefined, "", "morning", "evening", "afternoon", "25:00", "12:61", "noon", "later"]) {
      check(`${JSON.stringify(bad)} is not a clock time`, parseMinuteOfDay(bad) === null, String(parseMinuteOfDay(bad)));
    }
  }

  section("the legs of a day");

  {
    const legs = travelLegsFor([
      at(PANTHEON, "10:00", "Pantheon"),
      at(NAVONA, "11:00", "Piazza Navona"),
      at(TREVI, "12:00", "Trevi"),
    ]);
    check("three stops make two legs", legs.length === 2, String(legs.length));
    check("indices point at the rows", legs[0].fromIndex === 0 && legs[0].toIndex === 1, JSON.stringify(legs[0]));
    check("the second leg follows on", legs[1].fromIndex === 1 && legs[1].toIndex === 2);
    check("the allowed gap comes from the stated times", legs[0].allowedMinutes === 60, String(legs[0].allowedMinutes));
  }

  {
    // An unverified stop between two museums must not break the chain, or
    // the day silently loses the leg that matters most.
    const legs = travelLegsFor([
      at(VATICAN, "09:00", "Vatican"),
      stop({ time: "09:30", title: "A coffee somewhere" }),
      at(COLOSSEUM, "10:00", "Colosseum"),
    ]);
    check("an unplaced stop does not break the chain", legs.length === 1, String(legs.length));
    check("and the leg spans it", legs[0].fromIndex === 0 && legs[0].toIndex === 2, JSON.stringify(legs[0]));
  }

  {
    // A flight's endpoints are not a leg anyone walks or buses, and a
    // 900 km "transit leg" would swamp every real one.
    const legs = travelLegsFor([
      at(PANTHEON, "08:00", "Breakfast"),
      at({ lat: 41.8003, lng: 12.2389 }, "12:00", "Flight home", { is_flight: true }),
      at(TREVI, "18:00", "Trevi"),
    ]);
    check("a flight is not a stop on the route", legs.length === 1, String(legs.length));
    check("and the remaining leg is the real one", legs[0].metres < 2_000, String(legs[0].metres));
  }

  {
    check("one stop makes no legs", travelLegsFor([at(PANTHEON, "10:00", "Pantheon")]).length === 0);
    check("no stops make no legs", travelLegsFor([]).length === 0);
    check("undefined items make no legs", travelLegsFor(undefined).length === 0);
    // Every day, when there is no Places key - the same silence as DayMap.
    check(
      "stops without coordinates make no legs",
      travelLegsFor([stop({ time: "09:00" }), stop({ time: "10:00" })]).length === 0
    );
    check(
      "a NaN coordinate is not a coordinate",
      travelLegsFor([
        stop({ google_lat: Number.NaN, google_lng: 12.4 }),
        stop({ google_lat: 41.9, google_lng: 12.5 }),
      ]).length === 0
    );
  }

  {
    // A later item stated as an earlier time is a day that wraps past
    // midnight or a mis-ordered itinerary. Neither is a travel-time
    // problem, and a negative "allowed" would be reported as an impossible
    // leg and send whoever reads it after the wrong bug.
    const legs = travelLegsFor([at(PANTHEON, "22:00", "Late drink"), at(TREVI, "01:00", "Later")]);
    check("a backwards gap is not judged", legs[0].allowedMinutes === null, String(legs[0].allowedMinutes));
    check("but the leg is still measured", legs[0].metres > 0);
    check("and reads as ok rather than impossible", verdictFor(legs[0]) === "ok");
  }

  {
    const legs = travelLegsFor([at(PANTHEON, "morning", "Pantheon"), at(TREVI, "11:00", "Trevi")]);
    check("a vague time cannot be judged", legs[0].allowedMinutes === null);
    check("so the leg shows but does not fail", verdictFor(legs[0]) === "ok");
  }

  section("the verdict");

  {
    // The defect this exists for, with real numbers: the Colosseum at
    // 09:00 and a villa 34 km away at 09:30.
    const problems = travelProblemsFor([
      day([at(COLOSSEUM, "09:00", "Colosseum"), at(TIVOLI, "09:30", "Villa d'Este")]),
    ]);
    check("half an hour for 34 km is not possible", problems.length === 1, JSON.stringify(problems));
    check("and it is reported as a defect", problems[0]?.verdict === "impossible", problems[0]?.verdict);
    check("naming both ends", problems[0]?.fromTitle === "Colosseum" && problems[0]?.toTitle === "Villa d'Este");
    check("and the day", problems[0]?.day === 1);

    // An hour does not rescue it either, which is the point of a factor
    // rather than a fixed slack: 34 km is ~123 min by any means.
    check(
      "and neither does a whole hour",
      travelProblemsFor([day([at(COLOSSEUM, "09:00", "Colosseum"), at(TIVOLI, "10:00", "Villa d'Este")])])[0]
        ?.verdict === "impossible"
    );
  }

  {
    // The case that sounds impossible and is not, kept deliberately. This
    // is what I first wrote as the headline example; it went red, and the
    // numbers were right. 4.8 km is about 24 minutes across Rome.
    check(
      "an hour from the Vatican to the Colosseum is fine",
      travelProblemsFor([day([at(VATICAN, "09:00", "Vatican Museums"), at(COLOSSEUM, "10:00", "Colosseum")])]).length === 0
    );
    // Fifteen minutes for it is nine minutes late - a person hurrying, not
    // a broken day. A gate that fires here fires on half the trips in Rome
    // and gets switched off within a week.
    check(
      "and fifteen minutes is late, not impossible",
      travelProblemsFor([day([at(VATICAN, "09:00", "Vatican Museums"), at(COLOSSEUM, "09:15", "Colosseum")])]).length === 0
    );
    // Ten minutes is fourteen late, which is worth saying - as a warning,
    // never as a defect that fails a paid generation.
    const tight = travelProblemsFor([day([at(VATICAN, "09:00", "Vatican"), at(COLOSSEUM, "09:10", "Colosseum")])]);
    check("ten minutes is flagged", tight.length === 1, JSON.stringify(tight));
    check("but only as tight", tight[0]?.verdict === "tight", tight[0]?.verdict);
  }

  {
    // Generous where it should be. The estimate is an estimate, the times
    // are round numbers, and a stop's own duration is recorded nowhere - a
    // gate that fires on noise gets ignored, which costs more than it gains.
    const fine = travelProblemsFor([day([at(PANTHEON, "10:00", "Pantheon"), at(TREVI, "11:00", "Trevi")])]);
    check("an hour for a 10-minute walk is fine", fine.length === 0, JSON.stringify(fine));

    const alsoFine = travelProblemsFor([day([at(PANTHEON, "10:00", "Pantheon"), at(TREVI, "10:15", "Trevi")])]);
    check("fifteen minutes for a ~9 min walk is still fine", alsoFine.length === 0, JSON.stringify(alsoFine));
  }

  {
    // Two severities, because they are two different problems: ten minutes
    // short is someone arriving late, thirty is someone who cannot be
    // there at all.
    check("10 min over is tight", verdictFor({ fromIndex: 0, toIndex: 1, metres: 1600, mode: "walk", minutes: 20, allowedMinutes: 10 }) === "tight");
    check("9 min over is not worth saying", verdictFor({ fromIndex: 0, toIndex: 1, metres: 1520, mode: "walk", minutes: 19, allowedMinutes: 10 }) === "ok");
    check("30 min over is impossible", verdictFor({ fromIndex: 0, toIndex: 1, metres: 3200, mode: "walk", minutes: 40, allowedMinutes: 10 }) === "impossible");
    check("29 min over is only tight", verdictFor({ fromIndex: 0, toIndex: 1, metres: 3120, mode: "walk", minutes: 39, allowedMinutes: 10 }) === "tight");
    check("an unjudgeable leg is ok", verdictFor({ fromIndex: 0, toIndex: 1, metres: 9000, mode: "transit", minutes: 40, allowedMinutes: null }) === "ok");
  }

  {
    // Silence means "no evidence of a problem", never "checked and fine" -
    // the same distinction checkVenues draws between "we could not ask"
    // and "it does not exist".
    check(
      "a day with no coordinates reports nothing",
      travelProblemsFor([day([stop({ time: "09:00" }), stop({ time: "09:10" })])]).length === 0
    );
    check("no days report nothing", travelProblemsFor(undefined).length === 0);
    check("a day with no items reports nothing", travelProblemsFor([day([])]).length === 0);
    check(
      "a day whose items are missing reports nothing",
      travelProblemsFor([{ ...day([]), items: undefined as never }]).length === 0
    );
  }

  {
    // Every day, not just the first.
    const problems = travelProblemsFor([
      day([at(PANTHEON, "10:00", "Pantheon"), at(TREVI, "11:00", "Trevi")], 1),
      day([at(VATICAN, "09:00", "Vatican"), at(COLOSSEUM, "09:10", "Colosseum")], 2),
    ]);
    check("a problem on day 2 is found", problems.length === 1 && problems[0].day === 2, JSON.stringify(problems));
  }

  section("how it reads");

  {
    check("under a kilometre reads in metres", formatLegDistance(740) === "740 m", formatLegDistance(740));
    check("rounded to ten, not to the metre", formatLegDistance(743) === "740 m", formatLegDistance(743));
    check("a kilometre reads in km", formatLegDistance(1000) === "1.0 km", formatLegDistance(1000));
    check("and to one decimal", formatLegDistance(4712) === "4.7 km", formatLegDistance(4712));
  }

  finish();
}

main();
