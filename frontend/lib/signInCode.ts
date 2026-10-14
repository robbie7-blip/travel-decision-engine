// A six-digit sign-in code, sent in the same email as the sign-in link.
//
// WHY A CODE AS WELL. A link opens wherever the phone opens links - Safari
// or Chrome - which is not where a visitor from Messenger or Instagram is:
// they are in that app's own browser, with its own cookies. They tap the
// link, are signed in in Safari, go back to the tab they were using, and
// are still signed out there. A code typed into the same tab signs in
// that tab. It is also in the email's subject line, so on most phones it
// can be read off the notification without leaving the app at all.
//
// THE GUESSING PROBLEM, which a link does not have and a code does: there
// are a million six-digit codes. So:
//   - five wrong tries and the code is gone (a new email is needed)
//   - the IP is rate limited on top (SIGNIN_CODE_RATE_LIMIT)
//   - it lives fifteen minutes, like the link
//   - it is stored as an HMAC keyed with SESSION_SECRET, not as itself,
//     so a read of Redis alone does not hand out live codes
//   - one successful use deletes it
// Five tries in a million is a 1-in-200,000 chance per email sent, and
// each email costs a rate-limited request.
//
// Run: npm run test:signin-code

import { createHash, createHmac, randomInt, timingSafeEqual } from "crypto";
import type { Redis } from "@upstash/redis";
import { isUsableSessionSecret } from "./session";

export const SIGNIN_CODE_TTL_SECONDS = 60 * 15;
export const SIGNIN_CODE_MAX_ATTEMPTS = 5;
const CODE_SHAPE = /^\d{6}$/;

/** Keyed by a hash of the address, so the key list is not a list of
 * addresses. Lower-cased: "Me@Example.com" and "me@example.com" are the
 * same inbox, and the code has to be found from either. */
export function signInCodeKey(email: string): string {
  return `signincode:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
}

export function generateSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Spaces and dashes are what people type when copying "123 456". */
export function normalizeSignInCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s-]/g, "");
  return CODE_SHAPE.test(digits) ? digits : null;
}

function digest(code: string, email: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!isUsableSessionSecret(secret)) throw new Error("SESSION_SECRET is not usable - cannot issue sign-in codes.");
  return createHmac("sha256", secret as string).update(`${email.trim().toLowerCase()}:${code}`).digest("hex");
}

/** Replaces any earlier code for this address: only the newest email's
 * code works, which is what someone who asked twice expects. */
export async function storeSignInCode(redis: Redis, email: string, code: string): Promise<void> {
  const key = signInCodeKey(email);
  const p = redis.pipeline();
  p.del(key);
  p.hset(key, { h: digest(code, email), e: email, a: 0 });
  p.expire(key, SIGNIN_CODE_TTL_SECONDS);
  await p.exec();
}

export type SignInCodeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "expired" | "wrong" | "locked"; attemptsLeft?: number };

export async function verifySignInCode(redis: Redis, email: string, input: unknown): Promise<SignInCodeResult> {
  const code = normalizeSignInCode(input);
  const key = signInCodeKey(email);

  const stored = await redis.hget<string>(key, "h");
  if (!stored) return { ok: false, reason: "expired" };

  // The attempt is counted BEFORE the comparison, including for a
  // malformed code, so there is no input that tries without paying.
  const attempts = await redis.hincrby(key, "a", 1);
  if (attempts > SIGNIN_CODE_MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: "locked" };
  }

  const expected = Buffer.from(stored, "hex");
  const actual = code ? Buffer.from(digest(code, email), "hex") : Buffer.alloc(expected.length);
  const match = code !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!match) {
    if (attempts >= SIGNIN_CODE_MAX_ATTEMPTS) {
      await redis.del(key);
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "wrong", attemptsLeft: SIGNIN_CODE_MAX_ATTEMPTS - attempts };
  }

  // Single use. DEL's count decides it when two right answers race: only
  // the one that actually deleted the record signs in.
  const storedEmail = await redis.hget<string>(key, "e");
  const deleted = await redis.del(key);
  if (deleted !== 1 || !storedEmail) return { ok: false, reason: "expired" };
  return { ok: true, email: storedEmail };
}
