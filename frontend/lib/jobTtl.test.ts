// How long a trip lives, and the two ways that got decided wrong.
//
// 1. THE WORKER RESET IT. writeJob is `SET ... EX JOB_TTL_SECONDS` and runs
//    several times per generation - at pickup, on progress, at completion -
//    and SET with an EX replaces the key's lifetime outright. So any longer
//    lifetime chosen at enqueue was gone before the first model call
//    returned. The choice rides on the record now (Job.ttlSeconds) exactly
//    so it survives writes made by the other deployment.
//
// 2. `expire` IS NOT "KEEP AT LEAST". Two call sites wanted "make sure this
//    lives at least N" and both wrote `expire(key, N)`, which sets the TTL
//    in either direction. Once a signed-in traveller's trip starts life at
//    400 days, curating it into the showcase - the most deliberate thing an
//    editor can do to a trip - took five weeks off it.
//
// And the number itself was wrong for a paid artifact: thirty days means a
// trip planned in January for a June holiday expires in February, in the
// middle of the window it exists for, and the bookmarked /trip link stops
// working with nothing to recover.
//
// A fake Redis with real TTL semantics, so no network.
//
// Run: npm run test:job-ttl

import { JOB_TTL_SECONDS, SAVED_JOB_TTL_SECONDS, jobKey, ttlForJob, type Job } from "./jobs";
import { extendTtl, touchJobTtl } from "./jobTtl";
import { check, finish, heading, section } from "./testutil";

heading("trip lifetime");

/** TTL-only Redis. `ttl` returns -2 for a missing key and -1 for one with
 * no expiry, the way Redis does - both of which the code has to tell apart
 * from a real number of seconds. */
function fakeRedis(initial: Record<string, number> = {}) {
  const ttls = new Map<string, number>(Object.entries(initial));
  const calls: string[] = [];
  const redis = {
    ttl: async (key: string) => {
      calls.push(`ttl ${key}`);
      const v = ttls.get(key);
      return v === undefined ? -2 : v;
    },
    expire: async (key: string, seconds: number) => {
      calls.push(`expire ${key} ${seconds}`);
      ttls.set(key, seconds);
      return 1;
    },
  };
  return { redis, ttls, calls };
}

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    status: "done",
    brief: {},
    createdAt: 1,
    updatedAt: 2,
    ...over,
  }) as Job;

const DAY = 60 * 60 * 24;

async function main() {
  section("which lifetime a record asks for");

  {
    check("no field means the anonymous default", ttlForJob({}) === JOB_TTL_SECONDS, String(ttlForJob({})));
    check("a saved trip asks for its own", ttlForJob({ ttlSeconds: SAVED_JOB_TTL_SECONDS }) === SAVED_JOB_TTL_SECONDS);
    check("thirty days is 30 days", JOB_TTL_SECONDS === 30 * DAY, String(JOB_TTL_SECONDS / DAY));
    // Longer than a year on purpose: an annual trip planned slightly
    // earlier this year than last must not fall off between the two.
    check("and a saved trip outlives a year", SAVED_JOB_TTL_SECONDS > 366 * DAY, String(SAVED_JOB_TTL_SECONDS / DAY));
  }

  {
    // This value comes off a stored record, so it is not trusted. Redis
    // rejects a non-integer TTL outright, which would throw inside the
    // worker's write path and lose a finished, paid generation.
    for (const [label, ttlSeconds] of [
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["zero", 0],
      ["negative", -5],
      ["a string", "400" as unknown as number],
      ["null", null as unknown as number],
    ] as [string, number][]) {
      check(`a ${label} lifetime falls back to the default`, ttlForJob({ ttlSeconds }) === JOB_TTL_SECONDS, String(ttlForJob({ ttlSeconds })));
    }
    check("a fractional value is floored to an integer", ttlForJob({ ttlSeconds: 100.9 }) === 100);
    // Clamped, so a record cannot ask for an effectively permanent key.
    check("an absurd lifetime is capped", ttlForJob({ ttlSeconds: 1e12 }) === SAVED_JOB_TTL_SECONDS, String(ttlForJob({ ttlSeconds: 1e12 })));
  }

  section("extending, and never shortening");

  {
    // The defect: curation used expire(), which sets in either direction.
    const { redis, ttls } = fakeRedis({ "job:job-1": SAVED_JOB_TTL_SECONDS });
    const result = await extendTtl(redis, "job:job-1", 365 * DAY);
    check("a shorter target does not shorten the key", ttls.get("job:job-1") === SAVED_JOB_TTL_SECONDS, String(ttls.get("job:job-1")));
    check("and says so", result === "already-longer", result);
  }

  {
    const { redis, ttls } = fakeRedis({ "job:job-1": 5 * DAY });
    check("a longer target raises it", (await extendTtl(redis, "job:job-1", 365 * DAY)) === "extended");
    check("to the new value", ttls.get("job:job-1") === 365 * DAY, String(ttls.get("job:job-1")));
  }

  {
    // A key somebody deliberately made permanent is not this function's to
    // put a clock on.
    const { redis, ttls } = fakeRedis({ "job:job-1": -1 });
    check("a persistent key is left persistent", (await extendTtl(redis, "job:job-1", 365 * DAY)) === "already-longer");
    check("and gains no expiry", ttls.get("job:job-1") === -1, String(ttls.get("job:job-1")));
  }

  {
    const { redis, calls } = fakeRedis();
    check("a missing key is reported, not created", (await extendTtl(redis, "job:gone", 100)) === "missing");
    check("and nothing is written", calls.filter((c) => c.startsWith("expire")).length === 0, calls.join("; "));
  }

  {
    // A day of slack, so a trip opened five times in an afternoon costs
    // one read and no writes. Without it every view writes: the key is set
    // to exactly the target and is below it a second later.
    const { redis, calls } = fakeRedis({ "job:job-1": SAVED_JOB_TTL_SECONDS - 60 });
    check("a TTL a minute below target is left alone", (await extendTtl(redis, "job:job-1", SAVED_JOB_TTL_SECONDS)) === "already-longer");
    check("with no write", calls.filter((c) => c.startsWith("expire")).length === 0, calls.join("; "));

    const aged = fakeRedis({ "job:job-1": SAVED_JOB_TTL_SECONDS - 3 * DAY });
    check("three days of decay is topped up", (await extendTtl(aged.redis, "job:job-1", SAVED_JOB_TTL_SECONDS)) === "extended");
    check("back to full", aged.ttls.get("job:job-1") === SAVED_JOB_TTL_SECONDS, String(aged.ttls.get("job:job-1")));
  }

  {
    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const { redis, calls } = fakeRedis({ "job:job-1": 100 });
      check(`a ${bad} target writes nothing`, (await extendTtl(redis, "job:job-1", bad)) === "failed");
      check("  and does not even read", calls.length === 0, calls.join("; "));
    }
  }

  {
    // Bookkeeping about next year must never fail the page render.
    const exploding = {
      ttl: async () => {
        throw new Error("redis down");
      },
      expire: async () => {
        throw new Error("redis down");
      },
    };
    let threw = false;
    let out = "";
    try {
      out = await extendTtl(exploding, "job:job-1", 100);
    } catch {
      threw = true;
    }
    check("a Redis failure is swallowed", threw === false);
    check("and reported", out === "failed", out);
  }

  section("opening a finished trip keeps it");

  {
    const { redis, ttls } = fakeRedis({ [jobKey("job-1")]: 5 * DAY });
    await touchJobTtl(redis, job({ ttlSeconds: SAVED_JOB_TTL_SECONDS }));
    check("a saved trip is topped back up", ttls.get(jobKey("job-1")) === SAVED_JOB_TTL_SECONDS, String(ttls.get(jobKey("job-1"))));
  }

  {
    const { redis, ttls } = fakeRedis({ [jobKey("job-1")]: 2 * DAY });
    await touchJobTtl(redis, job());
    check("an anonymous trip slides on its own window", ttls.get(jobKey("job-1")) === JOB_TTL_SECONDS, String(ttls.get(jobKey("job-1"))));
  }

  {
    // The polling route calls this, and it polls every 400ms while a trip
    // generates - refreshing on each of those would be ~150 pointless
    // commands per generation, on a record whose whole lifetime is ahead
    // of it anyway.
    for (const status of ["pending", "running", "error"] as const) {
      const { redis, calls } = fakeRedis({ [jobKey("job-1")]: DAY });
      await touchJobTtl(redis, job({ status }));
      check(`a ${status} job is not touched at all`, calls.length === 0, calls.join("; "));
    }
  }

  finish();
}

main();
