// Run: npm run test:signin-code

import assert from "node:assert/strict";
import {
  generateSignInCode,
  normalizeSignInCode,
  signInCodeKey,
  SIGNIN_CODE_MAX_ATTEMPTS,
  storeSignInCode,
  verifySignInCode,
} from "./signInCode";

async function main() {
  process.env.SESSION_SECRET = "x".repeat(40);

  // A small Redis with the hash commands these use.
  const hashes = new Map<string, Record<string, string>>();
  const redis = {
    pipeline() {
      const ops: (() => void)[] = [];
      const p = {
        del: (k: string) => (ops.push(() => hashes.delete(k)), p),
        hset: (k: string, v: Record<string, unknown>) => (
          ops.push(() => hashes.set(k, { ...(hashes.get(k) ?? {}), ...Object.fromEntries(Object.entries(v).map(([a, b]) => [a, String(b)])) })),
          p
        ),
        expire: () => p,
        exec: async () => ops.forEach((op) => op()),
      };
      return p;
    },
    hget: async (k: string, f: string) => hashes.get(k)?.[f] ?? null,
    hincrby: async (k: string, f: string, n: number) => {
      const h = hashes.get(k) ?? {};
      h[f] = String(Number(h[f] ?? 0) + n);
      hashes.set(k, h);
      return Number(h[f]);
    },
    del: async (k: string) => (hashes.delete(k) ? 1 : 0),
  } as never;

  // Codes are six digits, including leading zeros.
  for (let i = 0; i < 200; i++) assert.match(generateSignInCode(), /^\d{6}$/);
  assert.equal(normalizeSignInCode("123 456"), "123456");
  assert.equal(normalizeSignInCode("123-456"), "123456");
  assert.equal(normalizeSignInCode("12345"), null);
  assert.equal(normalizeSignInCode("12345a"), null);
  assert.equal(normalizeSignInCode(123456), null);

  // The code is not stored as itself, and the key does not name the address.
  await storeSignInCode(redis, "Me@Example.com", "042917");
  const key = signInCodeKey("me@example.com");
  assert.ok(!key.includes("example"));
  assert.notEqual(hashes.get(key)?.h, "042917");
  assert.ok(!JSON.stringify(hashes.get(key)).includes("042917"));

  // Right code, any case of the address, signs in the address as typed - once.
  assert.deepEqual(await verifySignInCode(redis, "ME@example.com", "042 917"), { ok: true, email: "Me@Example.com" });
  assert.deepEqual(await verifySignInCode(redis, "me@example.com", "042917"), { ok: false, reason: "expired" });

  // Wrong tries count down, and the fifth wrong one burns the code - after
  // which even the right code does not work.
  await storeSignInCode(redis, "a@b.co", "111111");
  for (let i = 1; i < SIGNIN_CODE_MAX_ATTEMPTS; i++) {
    assert.deepEqual(await verifySignInCode(redis, "a@b.co", "000000"), { ok: false, reason: "wrong", attemptsLeft: SIGNIN_CODE_MAX_ATTEMPTS - i });
  }
  assert.deepEqual(await verifySignInCode(redis, "a@b.co", "000000"), { ok: false, reason: "locked" });
  assert.deepEqual(await verifySignInCode(redis, "a@b.co", "111111"), { ok: false, reason: "expired" });

  // Garbage still costs an attempt.
  await storeSignInCode(redis, "c@d.co", "222222");
  assert.deepEqual(await verifySignInCode(redis, "c@d.co", "not a code"), { ok: false, reason: "wrong", attemptsLeft: SIGNIN_CODE_MAX_ATTEMPTS - 1 });

  // A new email replaces the old code, and resets the count.
  await storeSignInCode(redis, "c@d.co", "333333");
  assert.deepEqual(await verifySignInCode(redis, "c@d.co", "222222"), { ok: false, reason: "wrong", attemptsLeft: SIGNIN_CODE_MAX_ATTEMPTS - 1 });
  assert.deepEqual(await verifySignInCode(redis, "c@d.co", "333333"), { ok: true, email: "c@d.co" });

  // A code for one address does not sign in another.
  await storeSignInCode(redis, "e@f.co", "444444");
  assert.deepEqual(await verifySignInCode(redis, "x@y.co", "444444"), { ok: false, reason: "expired" });

  console.log("signInCode: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
