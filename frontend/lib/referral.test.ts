// Run: npm run test:referral

import { bonusKey, isReferralCode, REFERRAL_MONTHLY_CAP, referralCodeFor, referralStats, rewardReferral, type ReferralRedis } from "./referral";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${name}${detail === undefined ? "" : ` - ${JSON.stringify(detail)}`}`);
  }
}

function fakeRedis(): ReferralRedis & { data: Map<string, string | number> } {
  const data = new Map<string, string | number>();
  return {
    data,
    async get<T>(key: string) {
      return (data.has(key) ? data.get(key) : null) as T | null;
    },
    async set(key: string, value: string, opts?: { nx?: boolean }) {
      if (opts?.nx && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async incr(key: string) {
      const n = Number(data.get(key) ?? 0) + 1;
      data.set(key, n);
      return n;
    },
    async incrby(key: string, by: number) {
      const n = Number(data.get(key) ?? 0) + by;
      data.set(key, n);
      return n;
    },
    async expire() {
      return 1;
    },
  };
}

async function main() {
  const redis = fakeRedis();
  const code = await referralCodeFor(redis, "Ana@Example.com");
  check("a code is eight safe characters", isReferralCode(code), code);
  check("the same code every time", (await referralCodeFor(redis, "ana@example.com")) === code);
  check("and it does not contain the address", !code.includes("ana"));
  check("another account gets another code", (await referralCodeFor(redis, "bo@example.com")) !== code);

  check("nobody can invite themselves", (await rewardReferral(redis, { friendEmail: "ANA@example.com", code, firstTrip: true })) === "self");
  check("an unknown code does nothing", (await rewardReferral(redis, { friendEmail: "x@example.com", code: "zzzzzzzz", firstTrip: true })) === "no-inviter");
  check("not on a second trip", (await rewardReferral(redis, { friendEmail: "old@example.com", code, firstTrip: false })) === "not-first-trip");

  check("a friend's first trip rewards both", (await rewardReferral(redis, { friendEmail: "f1@example.com", code, firstTrip: true, month: "2026-10" })) === "rewarded");
  check("the friend has a bonus trip", (await referralStats(redis, "f1@example.com")).bonus === 1);
  const ana = await referralStats(redis, "ana@example.com");
  check("so does the inviter, and the friend is counted", ana.bonus === 1 && ana.joined === 1, ana);
  check("a friend counts once", (await rewardReferral(redis, { friendEmail: "F1@example.com", code, firstTrip: true, month: "2026-10" })) === "already-counted");
  check("and is not rewarded twice", (await referralStats(redis, "f1@example.com")).bonus === 1);

  for (let i = 2; i <= REFERRAL_MONTHLY_CAP; i++) await rewardReferral(redis, { friendEmail: `f${i}@example.com`, code, firstTrip: true, month: "2026-10" });
  check("up to the monthly cap", (await referralStats(redis, "ana@example.com")).bonus === REFERRAL_MONTHLY_CAP);
  const over = await rewardReferral(redis, { friendEmail: "late@example.com", code, firstTrip: true, month: "2026-10" });
  check("past the cap the friend still gets theirs", over === "friend-only" && (await referralStats(redis, "late@example.com")).bonus === 1, over);
  check("but the inviter does not", (await referralStats(redis, "ana@example.com")).bonus === REFERRAL_MONTHLY_CAP);
  await rewardReferral(redis, { friendEmail: "next@example.com", code, firstTrip: true, month: "2026-11" });
  check("a new month, a new cap", (await referralStats(redis, "ana@example.com")).bonus === REFERRAL_MONTHLY_CAP + 1);
  check("the bonus key is per address, lowercased", bonusKey(" Ana@Example.com ") === "bonus:ana@example.com");

  if (failures) {
    console.error(`\nreferral: ${failures} failed`);
    process.exit(1);
  }
  console.log("referral: all assertions passed");
}

main();
