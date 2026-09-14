// Reading a traveller's own flight history out of a pasted confirmation.
//
// This is the function that decides what somebody's history says, and it was
// inside a route handler where nothing could reach it. Every "before" figure
// below was measured against the version it replaces, with the real
// countries table, not predicted.
//
// The rejections matter more than the acceptances here. A hallucinated
// country code marks a country visited that the traveller has never been to,
// which is the one error this feature must not make - and a THROWN error
// costs the whole import and tells them their email was unreadable, for a
// fault that was ours.
//
// Run: npm run test:flight-import

import { readImportedFlights, MAX_FLIGHT_IMPORT_CHARS, MIN_FLIGHT_IMPORT_CHARS } from "./flightImport";
import { check, finish, heading, section } from "./testutil";

heading("flight import");

/** A fixed "now", so "is this in the past" is a property of the code rather
 * than of the day the suite runs. */
const NOW = new Date(Date.UTC(2026, 8, 14)); // 2026-09-14

const leg = (over: Record<string, unknown> = {}) => ({
  departure_iata: "SOF",
  departure_city: "Sofia",
  arrival_iata: "RMO",
  arrival_city: "Chisinau",
  arrival_country_code: "MD",
  date: "2026-01-02",
  airline: "Wizz Air",
  flight_number: "W6 1234",
  ...over,
});

/** The reader, with a throw turned into "no flights".
 *
 * Not defensive tidiness: with the entry guard reverted, an unguarded call
 * here takes the whole tsx process down, and a suite that aborts says far
 * less than one that names the four assertions that changed. The section
 * that is specifically ABOUT throwing calls readImportedFlights directly,
 * so it still detects one. */
const read = (flights: unknown[]) => {
  try {
    return readImportedFlights({ flights }, NOW);
  } catch {
    return [];
  }
};

function main() {
  {
    section("a real booking reads through");

    const out = read([leg(), leg({ departure_iata: "RMO", arrival_iata: "SOF", arrival_city: "Sofia", arrival_country_code: "BG", date: "2026-01-09" })]);
    check("both legs", out.length === 2, String(out.length));
    check("in travel order", out[0]?.date === "2026-01-02" && out[1]?.date === "2026-01-09");
    check("arrival code", out[0]?.arrivalIata === "RMO");
    check("country", out[0]?.arrivalCountryCode === "MD");
    check("city", out[0]?.arrivalCity === "Chisinau");
    check("airline and number survive", out[0]?.airline === "Wizz Air" && out[0]?.flightNumber === "W6 1234");
    check("both are in the past relative to a fixed now", out.every((f) => f.isPast));

    // Lowercase input is normalised, which is what the old version did too.
    const lower = read([leg({ arrival_iata: "rmo", arrival_country_code: "md" })]);
    check("codes are uppercased", lower[0]?.arrivalIata === "RMO" && lower[0]?.arrivalCountryCode === "MD");
  }

  {
    section("a null entry no longer costs the whole import");

    // Measured before: `{"flights": [null]}` threw "Cannot read properties
    // of null (reading 'arrival_country_code')". The route's catch turns any
    // throw into "Couldn't read that confirmation. Try pasting the full
    // email text" - blaming the traveller's email for a fault of ours, which
    // is the exact thing the comment on that catch exists to prevent.
    for (const [label, entry] of [
      ["null", null],
      ["undefined", undefined],
      ["a nested array", []],
      ["a string", "RMO"],
      ["a number", 7],
    ] as [string, unknown][]) {
      // The real function, not the guarded helper - detecting a throw is
      // the whole point of this section.
      let threw = false;
      let out: ReturnType<typeof readImportedFlights> = [];
      try {
        out = readImportedFlights({ flights: [entry] }, NOW);
      } catch {
        threw = true;
      }
      check(`${label} does not throw`, threw === false);
      check(`  and yields no flight`, threw === false && out.length === 0);
    }

    // And the point of a `continue` rather than a refusal: one unreadable
    // leg costs that leg, not the booking.
    const mixed = read([leg(), null, leg({ date: "2026-01-09" }), { arrival_country_code: "ZZ" }]);
    check("the readable legs survive alongside junk", mixed.length === 2, String(mixed.length));
  }

  {
    section("the date has to be a date, not a shape");

    // The old check was /^\\d{4}-\\d{2}-\\d{2}$/ - a shape. parseCalendarDate
    // in jobs.ts already rejected impossible days and was sitting right
    // there; this route open-coded the weaker version beside it.
    check("9999-99-99 is refused", read([leg({ date: "9999-99-99" })]).length === 0);
    check("2026-02-30 is refused", read([leg({ date: "2026-02-30" })]).length === 0);
    check("2026-13-01 is refused", read([leg({ date: "2026-13-01" })]).length === 0);
    check("2026-00-10 is refused", read([leg({ date: "2026-01-00" })]).length === 0);

    // ...while the real leap day is not.
    check("2028-02-29 is a real date", read([leg({ date: "2028-02-29" })]).length === 1);
    check("  and 2027-02-29 is not", read([leg({ date: "2027-02-29" })]).length === 0);

    for (const bad of ["", "next week", "02/01/2026", "2026-1-2", 20260102, null]) {
      check(`${JSON.stringify(bad)} is refused`, read([leg({ date: bad })]).length === 0);
    }
  }

  {
    section("and in a year a flight could have happened in");

    check("1800 is refused", read([leg({ date: "1800-01-01" })]).length === 0);
    check("0001 is refused", read([leg({ date: "0001-01-01" })]).length === 0);
    check("2300 is refused", read([leg({ date: "2300-01-01" })]).length === 0);
    // Generous at both ends on purpose: refusing a real booking is worse
    // than accepting an implausible one, and a future flight is shown but
    // never counted as a visit.
    check("1950 is kept", read([leg({ date: "1950-06-01" })]).length === 1);
    check("a booking two years out is kept", read([leg({ date: "2028-06-01" })]).length === 1);
    check("  and is not a visit", read([leg({ date: "2028-06-01" })])[0]?.isPast === false);
  }

  {
    section("an IATA code has to look like one");

    // Shown to the traveller AS a code and read back as one, so prose in
    // that field is the model answering a different question.
    check("prose is refused", read([leg({ arrival_iata: "the airport in Chisinau" })]).length === 0);
    for (const bad of ["RM", "RMOO", "RM1", "", "R-O", "рмо", 123, null]) {
      check(`${JSON.stringify(bad)} is not an arrival code`, read([leg({ arrival_iata: bad })]).length === 0);
    }
    check("three letters are", read([leg({ arrival_iata: "LHR" })])[0]?.arrivalIata === "LHR");

    // The DEPARTURE code is optional, so a bad one drops the field and
    // keeps the leg - losing a whole leg over the airport it left from
    // would be the wrong trade.
    const oddDeparture = read([leg({ departure_iata: "somewhere in Bulgaria" })]);
    check("a bad departure code keeps the leg", oddDeparture.length === 1);
    check("  and empties the field", oddDeparture[0]?.departureIata === "");
    check("a good one is kept", read([leg({ departure_iata: "sof" })])[0]?.departureIata === "SOF");
  }

  {
    section("the country code is checked against the real list");

    // THE one that must not be wrong: a hallucinated code would mark a
    // country visited that the traveller has never been to.
    for (const bad of ["ZZ", "XX", "MDA", "M", "", "Moldova", 1, null]) {
      check(`${JSON.stringify(bad)} is refused`, read([leg({ arrival_country_code: bad })]).length === 0);
    }
    check("MD is real", read([leg({ arrival_country_code: "MD" })]).length === 1);
    check("GB is real", read([leg({ arrival_country_code: "gb" })])[0]?.arrivalCountryCode === "GB");
  }

  {
    section("free text that reaches the screen is bounded");

    const long = read([leg({ arrival_city: "x".repeat(500), departure_city: "y".repeat(500), airline: "z".repeat(500) })]);
    check("the city is capped", (long[0]?.arrivalCity.length ?? 0) <= 80, String(long[0]?.arrivalCity.length));
    check("  the departure city too", (long[0]?.departureCity.length ?? 0) <= 80);
    check("  and the airline", (long[0]?.airline?.length ?? 0) <= 80);

    check(
      "a missing city falls back to the code, as before",
      read([leg({ arrival_city: "" })])[0]?.arrivalCity === "RMO"
    );
    check("a missing airline is omitted, not empty", read([leg({ airline: "" })])[0]?.airline === undefined);
  }

  {
    section("the number of legs is bounded");

    const many = read(Array.from({ length: 200 }, (_, i) => leg({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` })));
    check("capped well under 200", many.length <= 40, String(many.length));
    check("  and the ones kept are real", many.every((f) => f.arrivalIata === "RMO"));
  }

  {
    section("the container itself");

    for (const [label, raw] of [
      ["null", null],
      ["undefined", undefined],
      ["a bare array", []],
      ["a string", "no flights"],
      ["a number", 42],
      ["no flights key", {}],
      ["flights as a string", { flights: "none" }],
      ["flights as an object", { flights: { a: 1 } }],
    ] as [string, unknown][]) {
      let threw = false;
      let out: ReturnType<typeof readImportedFlights> = [];
      try {
        out = readImportedFlights(raw, NOW);
      } catch {
        threw = true;
      }
      check(`${label} does not throw`, threw === false);
      check(`  and reads as no flights`, threw === false && out.length === 0);
    }

    // The documented empty answer, which is what the prompt asks for when
    // the text is a hotel confirmation or a newsletter.
    check("the documented empty reply", readImportedFlights({ flights: [] }, NOW).length === 0);
  }

  {
    section("the paste bounds the route enforces");

    check("a floor exists", MIN_FLIGHT_IMPORT_CHARS > 0);
    check("a ceiling exists", MAX_FLIGHT_IMPORT_CHARS > MIN_FLIGHT_IMPORT_CHARS);
    check("  and fits a real multi-leg confirmation", MAX_FLIGHT_IMPORT_CHARS >= 10000);
  }

  finish();
}

main();
