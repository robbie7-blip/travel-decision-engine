// The plans (app/pricing): the trial without an account, testers, and the
// Trip Pass. Against an in-memory stand-in for Redis.
//
// Run: npm run test:plans

import {
  getQuotaStatus,
  getUserRecord,
  grantTripPass,
  listTesters,
  resolvePlan,
  setTester,
  takeAnonymousTrip,
} from "./account";
import {
  ANON_MONTHLY_GENERATIONS,
  FREE_MONTHLY_GENERATIONS,
  PAID_MONTHLY_GENERATIONS,
} from "./planLimits";
import { check, finish, heading, section } from "./testutil";

heading("plans");

function memoryRedis() {
  const kv = new Map<string, unknown>();
  const hashes = new Map<string, Record<string, string>>();
  const sets = new Map<string, Set<string>>();
  const num = (k: string) => Number(kv.get(k) ?? 0);
  const redis = {
    async get(k: string) {
      return kv.has(k) ? kv.get(k) : null;
    },
    async set(k: string, v: unknown, opts?: { nx?: boolean }) {
      if (opts?.nx && kv.has(k)) return null;
      kv.set(k, v);
      return "OK";
    },
    async incr(k: string) {
      kv.set(k, num(k) + 1);
      return num(k);
    },
    async decr(k: string) {
      kv.set(k, num(k) - 1);
      return num(k);
    },
    async incrby(k: string, n: number) {
      kv.set(k, num(k) + n);
      return num(k);
    },
    async expire() {
      return 1;
    },
    async mget(...keys: string[]) {
      return keys.map((k) => (kv.has(k) ? kv.get(k) : null));
    },
    async hset(k: string, fields: Record<string, string>) {
      hashes.set(k, { ...(hashes.get(k) ?? {}), ...fields });
      return 1;
    },
    async hgetall(k: string) {
      return hashes.get(k) ?? null;
    },
    async sadd(k: string, v: string) {
      (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(v);
      return 1;
    },
    async srem(k: string, v: string) {
      sets.get(k)?.delete(v);
      return 1;
    },
    async smembers(k: string) {
      return [...(sets.get(k) ?? [])];
    },
  };
  return redis as unknown as Parameters<typeof getUserRecord>[0];
}

async function main() {
  section("the numbers");
  {
    check("one trip without an account", ANON_MONTHLY_GENERATIONS === 1);
    check("more once signed in, for free", FREE_MONTHLY_GENERATIONS === 2);
    check("the yearly plan gives more again", PAID_MONTHLY_GENERATIONS === 10);
  }

  section("the trial without an account");
  {
    const redis = memoryRedis();
    const oct = new Date("2026-10-28T10:00:00Z");
    check(
      "the first trip from a connection goes ahead",
      await takeAnonymousTrip(redis, "1.2.3.4", oct),
    );
    check(
      "the second that month is refused",
      !(await takeAnonymousTrip(redis, "1.2.3.4", oct)),
    );
    check(
      "still refused, and a refusal does not pile up",
      !(await takeAnonymousTrip(redis, "1.2.3.4", oct)),
    );
    check(
      "another connection has its own",
      await takeAnonymousTrip(redis, "5.6.7.8", oct),
    );
    check(
      "next month it is back",
      await takeAnonymousTrip(
        redis,
        "1.2.3.4",
        new Date("2026-11-02T10:00:00Z"),
      ),
    );
  }

  section("friends and family");
  {
    const redis = memoryRedis();
    await setTester(redis, " Mum@Example.com ", true);
    const user = await getUserRecord(redis, "mum@example.com");
    check("a tester is marked on their account", user?.tester === true);
    check(
      "and gets the paid plan without paying",
      resolvePlan("mum@example.com", null, user?.tester) === "paid",
    );
    check(
      "listed for the admin page",
      (await listTesters(redis)).join() === "mum@example.com",
    );
    await setTester(redis, "mum@example.com", false);
    const after = await getUserRecord(redis, "mum@example.com");
    check(
      "taken off, back to free",
      after?.tester === false &&
        resolvePlan("mum@example.com", null, after?.tester) === "free",
    );
    check("and off the list", (await listTesters(redis)).length === 0);
    check(
      "a paying subscriber is unaffected",
      resolvePlan("pay@example.com", "active") === "paid",
    );
  }

  section("the Trip Pass");
  {
    const redis = memoryRedis();
    check(
      "a payment adds one trip",
      await grantTripPass(redis, "ann@example.com", "cs_1"),
    );
    check(
      "the same payment delivered again adds nothing",
      !(await grantTripPass(redis, "ann@example.com", "cs_1")),
    );
    check(
      "a second payment adds another",
      await grantTripPass(redis, "ann@example.com", "cs_2"),
    );
    const quota = await getQuotaStatus(redis, "ann@example.com", "free");
    check(
      "two extra trips on the account",
      quota.bonus === 2,
      JSON.stringify(quota),
    );
    check("usable once the month's free trips are gone", quota.allowed);
  }

  finish();
}

void main();
