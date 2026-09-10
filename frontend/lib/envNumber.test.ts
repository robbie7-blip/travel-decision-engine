// Tests how numeric environment variables are read.
//
// This looks like the least interesting file in the repo and covers one of
// the more dangerous defects found in it. Five places read a number out of
// process.env as `Number(process.env.X ?? default)`, which fails on the two
// most likely dashboard mistakes:
//
//   - An empty string. Setting a Vercel/Railway variable and saving it
//     blank leaves it PRESENT, so `??` does not fall back, and Number("")
//     is 0. On FREE_MONTHLY_GENERATIONS that locks every account out with
//     "You've used all 0 free generations this month" while the pricing
//     page advertises 0. On GENERATE_RATE_LIMIT_PER_HOUR it is
//     slidingWindow(0) - every generation request rejected, sitewide.
//   - A typo ("6o", "5 per hour", "twenty"). Number() gives NaN, which
//     compares false against everything, so a limit check silently stops
//     limiting - and the traveler is told they have used all NaN of their
//     generations.
//
// Neither has an error path. Both just become the product's behaviour.
//
// Run: npm run test:env-number

import { envFloat, envInt, positiveIntOr } from "./envNumber";
import { check, finish, heading, section } from "./testutil";

heading("numeric environment variables");

const NAME = "TEST_ONLY_ENV_NUMBER";

/** Runs envInt with NAME set to `raw` (or unset when undefined). */
function withEnv(raw: string | undefined, fallback: number): number {
  const had = Object.hasOwn(process.env, NAME);
  const previous = process.env[NAME];
  if (raw === undefined) delete process.env[NAME];
  else process.env[NAME] = raw;
  try {
    return envInt(NAME, fallback);
  } finally {
    if (had) process.env[NAME] = previous;
    else delete process.env[NAME];
  }
}

async function main() {
  section("the values that break the naive read");

  // The two findings, stated as the numbers they produce.
  check("an empty string falls back, it does not become 0", withEnv("", 5) === 5, String(withEnv("", 5)));
  check("whitespace falls back too", withEnv("   ", 5) === 5, String(withEnv("   ", 5)));
  check("a typo falls back, it does not become NaN", withEnv("6o", 5) === 5, String(withEnv("6o", 5)));
  check("prose falls back", withEnv("twenty", 5) === 5, String(withEnv("twenty", 5)));
  check("the result is always finite", Number.isFinite(withEnv("nonsense", 5)));

  section("values that mean something, but not something safe");

  check("0 falls back - a limit of zero is an outage, not a setting", withEnv("0", 5) === 5, String(withEnv("0", 5)));
  check("a negative falls back", withEnv("-3", 5) === 5, String(withEnv("-3", 5)));

  section("values that should be honoured");

  check("a plain integer is used", withEnv("12", 5) === 12);
  check("surrounding whitespace is tolerated", withEnv("  12  ", 5) === 12);
  check("unset falls back", withEnv(undefined, 5) === 5);
  // Floored rather than rejected, which is the right call for a count:
  // someone typing 12.7 into a "generations per month" field means 12, and
  // refusing the whole value would silently give them the default instead.
  check("a decimal floors to an integer", withEnv("12.7", 5) === 12, String(withEnv("12.7", 5)));
  // Parsing takes the whole string, not a valid prefix. parseInt("1e5") is
  // 1 - so raising a rate limit to 100,000/hour with exponent notation
  // would instead have set it to 1/hour, silently, which is a sitewide
  // outage dressed as a config change.
  check("exponent notation is read as the number it is", withEnv("1e5", 5) === 100_000, String(withEnv("1e5", 5)));
  check("a value under 1 falls back rather than flooring to zero", withEnv("0.4", 5) === 5, String(withEnv("0.4", 5)));

  section("envFloat, for rates rather than counts");

  const hadRate = Object.hasOwn(process.env, NAME);
  process.env[NAME] = "2.5";
  check("a decimal rate is kept as a decimal", envFloat(NAME, 3) === 2.5, String(envFloat(NAME, 3)));
  process.env[NAME] = "";
  check("an empty rate falls back", envFloat(NAME, 3) === 3);
  process.env[NAME] = "cheap";
  check("an unparseable rate falls back", envFloat(NAME, 3) === 3);
  process.env[NAME] = "-2";
  check("a negative rate falls back", envFloat(NAME, 3) === 3);
  if (!hadRate) delete process.env[NAME];

  section("positiveIntOr, for the NEXT_PUBLIC_ values");

  // The client-visible limits have to pass the VALUE in rather than the
  // name: Next.js inlines process.env.NEXT_PUBLIC_FOO by substituting the
  // literal text at build time, and a dynamic process.env[name] lookup is
  // not substituted - it reads as undefined in the browser, which would
  // make the pricing page silently disagree with what the server enforces.
  check("an empty value falls back", positiveIntOr("", 5) === 5);
  check("undefined falls back", positiveIntOr(undefined, 5) === 5);
  check("a typo falls back", positiveIntOr("6o", 5) === 5);
  check("0 falls back", positiveIntOr("0", 5) === 5);
  check("a real value is used", positiveIntOr("60", 5) === 60);

  section("the shipped defaults survive an unset environment");

  // Imported here rather than at the top of the file so the reads above run
  // first - these two are module-level constants, evaluated on import.
  const { FREE_MONTHLY_GENERATIONS, PAID_MONTHLY_GENERATIONS } = await import("./planLimits");
  check("free tier is a usable positive integer", Number.isInteger(FREE_MONTHLY_GENERATIONS) && FREE_MONTHLY_GENERATIONS > 0, String(FREE_MONTHLY_GENERATIONS));
  check("paid tier is a usable positive integer", Number.isInteger(PAID_MONTHLY_GENERATIONS) && PAID_MONTHLY_GENERATIONS > 0, String(PAID_MONTHLY_GENERATIONS));
  check("paid is more generous than free", PAID_MONTHLY_GENERATIONS > FREE_MONTHLY_GENERATIONS);

  const { GENERATE_RATE_LIMIT, AUTH_RATE_LIMIT, FEEDBACK_RATE_LIMIT, FLIGHT_IMPORT_RATE_LIMIT, TRIP_QUESTIONS_RATE_LIMIT } =
    await import("./ratelimit");
  const limits = [
    ["generate", GENERATE_RATE_LIMIT],
    ["auth", AUTH_RATE_LIMIT],
    ["feedback", FEEDBACK_RATE_LIMIT],
    ["flight import", FLIGHT_IMPORT_RATE_LIMIT],
    ["trip questions", TRIP_QUESTIONS_RATE_LIMIT],
  ] as const;
  for (const [label, limit] of limits) {
    check(
      `${label} limits are positive integers`,
      Number.isInteger(limit.perHour) && limit.perHour > 0 && Number.isInteger(limit.perDay) && limit.perDay > 0,
      `${limit.perHour}/h, ${limit.perDay}/d`
    );
    check(`${label} daily allowance is at least the hourly one`, limit.perDay >= limit.perHour, `${limit.perHour}/h vs ${limit.perDay}/d`);
  }

  finish();
}

main();
