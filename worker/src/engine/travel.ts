// How far apart the stops in a day actually are, and whether the day
// leaves time to get between them.
//
// This is the gap between an itinerary that reads well and one a person
// can execute. The most common way an AI day plan fails is not a wrong
// fact - it is a day-trip destination dropped into the middle of a city
// day. 09:00 at the Colosseum and 09:30 at the Villa d'Este in Tivoli is
// a real pair of places, a real pair of times, and 34 km of Lazio in
// between. The acceptance gate checked prices, meals, opening hours,
// duplicate venues and unaccounted hours; it never checked whether the
// day was physically possible.
//
// The coordinates to answer it were already there. checkVenues writes
// google_lat/google_lng onto every Places-verified item (see
// venueVerification.ts), and DayMap was already using them to draw the
// day's shape. The shape was the hint: you can SEE a day that doubles
// across a city, which means the information to catch it was on the page
// and only a person could read it.
//
// A NOTE ON CALIBRATION, kept because it is the whole argument for having
// arithmetic here at all. That example was first written as the Vatican
// Museums at 09:00 and the Colosseum at 10:00, which sounds impossible
// and is not: 4.8 km, about 24 minutes across Rome, and an hour is
// plenty. The same pair with only 15 minutes between them is nine minutes
// late, which is a person hurrying, not a broken day. What is actually
// broken is off by a factor - 34 km with half an hour for it - and that is
// what the thresholds below are set to catch. A gate tuned to the version
// that merely sounds wrong would fire on half the trips in Rome and be
// switched off within a week.
//
// WHAT THIS IS NOT: routing. No Directions API, no Distance Matrix, no
// street network - a straight line between two points, multiplied by a
// detour factor, at a walking pace. A deliberate choice, not a shortcut
// waiting to be upgraded:
//
//   - It costs nothing and adds no latency, on a pipeline already fighting
//     for every second against a 30s budget. Real routing is one API call
//     per consecutive pair - eight or more per trip - on the critical path.
//   - The load-bearing use is catching the impossible day, and street
//     accuracy is not what that needs. Nothing routes 34 km in 30 minutes.
//   - Pretending to a precision we do not have would be the one thing this
//     product does not do. Every number it shows says where it came from;
//     an estimate is labelled an estimate, the same way source_confidence
//     separates grounded from inferred.

import type { ItineraryDay, ItineraryItem } from "../types";

/** Metres per degree of latitude. Longitude degrees shrink towards the
 * poles, which is why the east-west component is scaled by cos(latitude) -
 * without it a day in Reykjavik measures roughly twice as wide as it is.
 * Same constant and same correction as DayMap's scale bar, so the distance
 * quoted beside a leg and the distance the plot implies agree. */
const M_PER_DEG_LAT = 111_320;

/** Street distance against straight-line distance, in a city.
 *
 * A grid forces you around blocks; a river or a rail cutting forces you to
 * a bridge. 1.3 is the middle of the range usually measured for dense
 * European and North American centres, and it is applied in the direction
 * that matters: it makes every leg LONGER than the crow flies, so the
 * estimate errs towards "this day is tight" rather than towards telling
 * someone a walk is shorter than it is. */
const DETOUR_FACTOR = 1.3;

/** Metres per minute on foot: 4.8 km/h.
 *
 * Deliberately below the ~5.3 km/h a fit adult walks on an empty path.
 * This is a city, with crossings, corners, a map being checked and other
 * people on the pavement - and the person may have been walking since
 * breakfast. A pace that flatters the traveller produces a day that only
 * works on paper. */
const WALK_M_PER_MIN = 80;

/** Beyond this, nobody walks between two stops on a holiday, whatever the
 * arithmetic says - 2 km is a 26-minute walk by the numbers above and a
 * real person takes the metro. Past it the leg is reported as transit and
 * the estimate changes character, which is why the mode is part of the
 * answer rather than something the caller infers from the distance. */
const WALK_LIMIT_M = 2_000;

/** Metres per minute for the transit/taxi case: ~18 km/h door to door.
 *
 * Far below any vehicle's speed, on purpose - this is not a journey time,
 * it is a door-to-door time, and it has to carry the walk to the stop, the
 * wait, the change, and the walk at the other end. A 6 km hop across a
 * European city really does take about twenty minutes, and almost none of
 * that is spent moving at 18 km/h. */
const TRANSIT_M_PER_MIN = 300;

/** A fixed cost on every transit leg, in minutes: finding the stop,
 * waiting, and getting out at the other end. Without it a short hop comes
 * out at three minutes, which is arithmetically true and practically
 * absurd. */
const TRANSIT_OVERHEAD_MIN = 8;

export type TravelMode = "walk" | "transit";

export interface TravelLeg {
  /** Index into the day's items array, so a caller can render the leg
   * between the two rows it belongs to without matching on anything. */
  fromIndex: number;
  toIndex: number;
  /** Estimated street distance, metres - straight line times DETOUR_FACTOR. */
  metres: number;
  mode: TravelMode;
  /** Estimated door-to-door minutes, rounded up: half a minute short is
   * still short. */
  minutes: number;
  /** Minutes the itinerary itself leaves between the two items, from their
   * own stated times, or null when either time is not a clock time
   * ("morning", "evening"). Null means the leg can be shown but cannot be
   * judged. */
  allowedMinutes: number | null;
}

/** Straight-line distance between two coordinates, in metres.
 *
 * Equirectangular rather than full haversine: over the few kilometres of a
 * city day the difference is under a metre, and the cos(latitude)
 * correction is the part that actually matters at any latitude. */
export function straightLineMetres(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const midLat = ((fromLat + toLat) / 2) * (Math.PI / 180);
  const dy = (toLat - fromLat) * M_PER_DEG_LAT;
  const dx = (toLng - fromLng) * M_PER_DEG_LAT * Math.cos(midLat);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Minutes past midnight for an item's stated time, or null.
 *
 * Minutes, where the gate's own parseHour gives hours: an hour's
 * granularity cannot tell 09:00-to-09:15 from 09:00-to-09:59, and the
 * fifteen-minute version is exactly the impossible day this is here to
 * catch. Deliberately refuses the vague forms parseHour accepts
 * ("morning", "evening") rather than inventing 09:00 for them - guessing a
 * clock time and then failing a day against the guess would be the gate
 * reporting its own assumption as the traveller's mistake. */
export function parseMinuteOfDay(time: string | undefined): number | null {
  if (!time) return null;
  const m = /(\d{1,2})[:.](\d{2})/.exec(time);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Whether this item is a point on the ground you walk to.
 *
 * Flights are excluded because the distance between two airports is not a
 * leg anybody walks or takes a bus for, and a 900 km "transit leg" would
 * swamp every real one. Items with no verified coordinates are excluded
 * because they have no position - which is most of them when there is no
 * Places key, and this whole module simply produces nothing then, the same
 * way DayMap renders nothing. */
function isPlaced(item: ItineraryItem): boolean {
  return (
    item.is_flight !== true &&
    typeof item.google_lat === "number" &&
    Number.isFinite(item.google_lat) &&
    typeof item.google_lng === "number" &&
    Number.isFinite(item.google_lng)
  );
}

/** The travel estimate for one hop. */
export function estimateHop(metres: number): { mode: TravelMode; minutes: number } {
  if (metres <= WALK_LIMIT_M) {
    return { mode: "walk", minutes: Math.max(1, Math.ceil(metres / WALK_M_PER_MIN)) };
  }
  return {
    mode: "transit",
    minutes: Math.max(1, Math.ceil(metres / TRANSIT_M_PER_MIN) + TRANSIT_OVERHEAD_MIN),
  };
}

/** Every leg between consecutive placed stops in a day, in the order the
 * items appear.
 *
 * Consecutive among PLACED items, not among all items - an unverified stop
 * or a taxi transfer between two museums should not break the chain, or a
 * day would silently lose the leg that matters most. */
export function travelLegsFor(items: ItineraryItem[] | undefined): TravelLeg[] {
  const placed: { item: ItineraryItem; index: number }[] = [];
  (items ?? []).forEach((item, index) => {
    if (isPlaced(item)) placed.push({ item, index });
  });

  const legs: TravelLeg[] = [];
  for (let i = 1; i < placed.length; i++) {
    const from = placed[i - 1];
    const to = placed[i];
    const metres =
      straightLineMetres(
        from.item.google_lat as number,
        from.item.google_lng as number,
        to.item.google_lat as number,
        to.item.google_lng as number
      ) * DETOUR_FACTOR;
    const { mode, minutes } = estimateHop(metres);

    const fromMinute = parseMinuteOfDay(from.item.time);
    const toMinute = parseMinuteOfDay(to.item.time);
    // Only forward gaps. A later item stated as an earlier time is either a
    // day that wraps past midnight or a mis-ordered itinerary, and neither
    // is a travel-time problem - a negative "allowed" would be reported as
    // an impossible leg and send whoever reads it after the wrong bug.
    const allowedMinutes =
      fromMinute != null && toMinute != null && toMinute >= fromMinute ? toMinute - fromMinute : null;

    legs.push({ fromIndex: from.index, toIndex: to.index, metres: Math.round(metres), mode, minutes, allowedMinutes });
  }
  return legs;
}

/** How much slack a leg has to be short of before it is worth saying so.
 *
 * Not zero. The estimate is an estimate, the stated times are round
 * numbers, and a stop's own duration is not recorded anywhere - so a leg
 * whose travel time is a few minutes over the gap is noise, and a gate
 * that fires on noise gets ignored, which costs more than the check gains.
 * Ten minutes past is a person arriving late; thirty is a person who
 * cannot be there at all. */
const TIGHT_MARGIN_MIN = 10;
const IMPOSSIBLE_MARGIN_MIN = 30;

export type TravelVerdict = "ok" | "tight" | "impossible";

/** Whether the day leaves time for this leg.
 *
 * "ok" also covers every leg we cannot judge - a vague time, a stop with no
 * coordinates. Silence on a leg means "no evidence of a problem", never
 * "checked and fine", which is the same distinction checkVenues draws
 * between "we could not ask" and "it does not exist". */
export function verdictFor(leg: TravelLeg): TravelVerdict {
  if (leg.allowedMinutes == null) return "ok";
  const over = leg.minutes - leg.allowedMinutes;
  if (over >= IMPOSSIBLE_MARGIN_MIN) return "impossible";
  if (over >= TIGHT_MARGIN_MIN) return "tight";
  return "ok";
}

export interface TravelProblem {
  day: number;
  leg: TravelLeg;
  verdict: "tight" | "impossible";
  fromTitle: string;
  toTitle: string;
}

/** Every leg in the trip the day does not leave time for. */
export function travelProblemsFor(days: ItineraryDay[] | undefined): TravelProblem[] {
  const problems: TravelProblem[] = [];
  for (const day of days ?? []) {
    const items = day.items ?? [];
    for (const leg of travelLegsFor(items)) {
      const verdict = verdictFor(leg);
      if (verdict === "ok") continue;
      problems.push({
        day: day.day,
        leg,
        verdict,
        fromTitle: items[leg.fromIndex]?.title ?? "",
        toTitle: items[leg.toIndex]?.title ?? "",
      });
    }
  }
  return problems;
}

/** "1.4 km" / "600 m", the same way DayMap's scale bar reads. */
export function formatLegDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
}
