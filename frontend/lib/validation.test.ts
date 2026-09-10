// Tests the door every paid generation comes through.
//
// parseTripBrief is the only thing between a public HTTP request and a job
// the worker will spend real Anthropic money on, and until this suite it
// checked that start_date and end_date were non-empty STRINGS and nothing
// else. Not that they were dates. Not that the end came after the start.
// Not how far apart they were - which matters more than anything else here,
// because two-phase generation makes one model call per planned day plus a
// Google Places pass over that day's venues, and the day count comes
// entirely from those two strings.
//
// So `{"start_date":"2026-01-01","end_date":"2026-12-31"}` was a valid
// brief that commissioned 365 day calls. The daily spend cap does not catch
// it: checkDailyBudget is a pre-check READ, so it sees the total before the
// job runs and the job that blows past the cap is the one that was never
// measured against it. At five requests an hour that is ~1,800 day calls
// before anything says no.
//
// Nothing in this file needs Redis, a key, or a network. Run:
//   npm run test:validation

import { MAX_TRIP_DAYS, parseTripBrief, tripDayCount, ValidationError } from "./validation";
import { check, finish, heading, section } from "./testutil";

heading("request validation - the paid-generation door");

/** A brief that parses, so each case below changes exactly one thing. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    destinations: ["Rome"],
    start_date: "2026-04-10",
    end_date: "2026-04-14",
    party_size: 2,
    party_composition: "two adults",
    pace: "moderate",
    ...overrides,
  };
}

/** The ValidationError message, or null if it parsed. */
function rejection(body: unknown): string | null {
  try {
    parseTripBrief(body);
    return null;
  } catch (e) {
    if (e instanceof ValidationError) return e.message;
    throw e;
  }
}

async function main() {
  section("the baseline still parses");

  const ok = parseTripBrief(validBody());
  check("a normal five-day Rome brief is accepted", ok.start_date === "2026-04-10" && ok.end_date === "2026-04-14");
  check("dates come back trimmed", parseTripBrief(validBody({ start_date: "  2026-04-10  " })).start_date === "2026-04-10");

  section("trip length - the cost multiplier");

  // The finding this suite was written for. A year-long range is one HTTP
  // request and 365 paid day calls.
  const yearLong = rejection(validBody({ start_date: "2026-01-01", end_date: "2026-12-31" }));
  check("a year-long range is rejected", yearLong !== null, String(yearLong));
  check(
    "and the message says how long it was and what the cap is",
    yearLong !== null && yearLong.includes("365") && yearLong.includes(String(MAX_TRIP_DAYS)),
    String(yearLong)
  );

  // The boundary, from both sides. An off-by-one here is either a rejected
  // legitimate trip or an extra unbounded day.
  //
  // The end date is computed through Date rather than by adding to the day
  // number, because the first attempt at this test produced "2026-04-39"
  // and failed against correct code - April has 30 days.
  const START = "2026-04-10";
  const endAfterDays = (days: number): string =>
    new Date(Date.parse(`${START}T00:00:00Z`) + (days - 1) * 86400000).toISOString().slice(0, 10);

  const atCap = endAfterDays(MAX_TRIP_DAYS);
  check(
    `exactly ${MAX_TRIP_DAYS} days is allowed`,
    tripDayCount(START, atCap) === MAX_TRIP_DAYS && rejection(validBody({ start_date: START, end_date: atCap })) === null,
    `start ${START}, end ${atCap}, span ${tripDayCount(START, atCap)}`
  );
  const overCap = endAfterDays(MAX_TRIP_DAYS + 1);
  check(
    `${MAX_TRIP_DAYS + 1} days is not`,
    tripDayCount(START, overCap) === MAX_TRIP_DAYS + 1 && rejection(validBody({ start_date: START, end_date: overCap })) !== null,
    `start ${START}, end ${overCap}, span ${tripDayCount(START, overCap)}`
  );

  check("a single-day trip is fine", rejection(validBody({ start_date: "2026-04-10", end_date: "2026-04-10" })) === null);

  section("date shape and order");

  check("end before start is rejected", rejection(validBody({ start_date: "2026-04-14", end_date: "2026-04-10" })) !== null);

  for (const bad of ["not a date", "2026", "2026-4-10", "10/04/2026", "2026-04-10T00:00:00Z", "2026-13-01", "2026-02-30", "0000-00-00"]) {
    check(`"${bad}" is not a start_date`, rejection(validBody({ start_date: bad })) !== null);
  }

  // Date.parse accepts "2026-13-45" and rolls it into the next year, which
  // is why this uses its own parser rather than leaning on the built-in.
  check("2026-02-30 does not roll over into March", tripDayCount("2026-02-30", "2026-03-01") === null);
  check("a real leap day is accepted", rejection(validBody({ start_date: "2028-02-29", end_date: "2028-03-01" })) === null);

  section("tripDayCount");

  check("inclusive of both ends", tripDayCount("2026-04-10", "2026-04-14") === 5, String(tripDayCount("2026-04-10", "2026-04-14")));
  check("same day is one day", tripDayCount("2026-04-10", "2026-04-10") === 1);
  // A range crossing a DST boundary is 24-hour-arithmetic's classic trap;
  // the parser works in UTC so it can't be bitten by it. Europe/Sofia
  // springs forward on 2026-03-29.
  check("a range crossing a DST change is still exact", tripDayCount("2026-03-28", "2026-03-30") === 3, String(tripDayCount("2026-03-28", "2026-03-30")));
  check("unparseable returns null, not a number", tripDayCount("nonsense", "2026-04-14") === null);

  section("city count - the other multiplier");

  // Lodging prefetch and venue verification both fan out per city,
  // independently of the day cap.
  const manyCities = Array.from({ length: MAX_TRIP_DAYS + 1 }, (_, i) => `City ${i}`);
  check(`${MAX_TRIP_DAYS + 1} cities is rejected`, rejection(validBody({ destinations: manyCities })) !== null);
  check("no cities at all is rejected", rejection(validBody({ destinations: [] })) !== null);
  check("one city is fine", rejection(validBody({ destinations: ["Rome"] })) === null);

  section("free text that reaches the prompt");

  // The array-length caps were decoration without a per-entry cap: 50
  // entries of a megabyte each is the same prompt bloat, and the same
  // injection surface, as 50,000 short ones.
  const huge = "x".repeat(5000);
  const withHuge = parseTripBrief(validBody({ interests: [huge] }));
  check("a 5,000-character interest is truncated", withHuge.interests[0].length < 500, `length ${withHuge.interests[0].length}`);

  const manyEntries = parseTripBrief(validBody({ must_see: Array.from({ length: 500 }, (_, i) => `place ${i}`) }));
  check("500 must-sees are capped", manyEntries.must_see.length <= 50, String(manyEntries.must_see.length));

  const longComposition = parseTripBrief(validBody({ party_composition: huge }));
  check("party_composition is length-capped too", longComposition.party_composition.length < 500, String(longComposition.party_composition.length));

  const longOrigin = parseTripBrief(validBody({ origin: huge }));
  check("so is origin", (longOrigin.origin ?? "").length < 500, String((longOrigin.origin ?? "").length));

  // visited_countries is the one the /api/generate route is supposed to
  // overwrite from the account - see the route test below - but it comes
  // through here first, and a length-unbounded array under a key the prompt
  // trusts is the worst combination available.
  const visited = parseTripBrief(validBody({ visited_countries: [huge, ...Array.from({ length: 500 }, () => "Italy")] }));
  check("visited_countries is capped both ways", visited.visited_countries!.length <= 50 && visited.visited_countries!.every((v) => v.length < 500));

  section("numbers");

  check("party_size 0 is rejected", rejection(validBody({ party_size: 0 })) !== null);
  check("party_size 1e9 is rejected", rejection(validBody({ party_size: 1e9 })) !== null);
  check("party_size 2 is fine", parseTripBrief(validBody({ party_size: 2 })).party_size === 2);
  check("a negative budget is rejected", rejection(validBody({ budget_total_eur: -1 })) !== null);
  check("a 1e300 budget is rejected", rejection(validBody({ budget_total_eur: 1e300 })) !== null);
  check("a null budget is fine", parseTripBrief(validBody({ budget_total_eur: null })).budget_total_eur === null);
  check("Infinity is rejected", rejection(validBody({ budget_total_eur: Infinity })) !== null);

  section("arrival details");

  check("a malformed arrival_date is rejected", rejection(validBody({ needs_flight: false, arrival_date: "next tuesday" })) !== null);
  check("a real arrival_date is accepted", rejection(validBody({ needs_flight: false, arrival_date: "2026-04-10" })) === null);
  // Deliberately free text - the form's own placeholder says "e.g. 8pm, or
  // 'evening'", so a strict HH:MM check here would reject the intended
  // input. Only the length is bounded.
  check("arrival_time stays free text", parseTripBrief(validBody({ arrival_time: "evening" })).arrival_time === "evening");
  check("but is length-capped", (parseTripBrief(validBody({ arrival_time: huge })).arrival_time ?? "").length < 500);

  section("shapes that aren't briefs at all");

  check("null body", rejection(null) !== null);
  check("a string body", rejection("give me a trip") !== null);
  check("an array body", rejection([1, 2, 3]) !== null);
  check("destinations as a string, not an array", rejection(validBody({ destinations: "Rome" })) !== null);
  check("a missing pace", rejection({ ...validBody(), pace: undefined }) !== null);
  check("an invented pace", rejection(validBody({ pace: "frantic" })) !== null);

  finish();
}

main();
