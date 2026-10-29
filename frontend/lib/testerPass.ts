// The tester link: friends and family tap one private link and that
// browser gets the paid plan, with no email and no sign-in.
//
// The link carries a random code kept in Redis (/admin/testers makes,
// replaces and turns it off). Tapping it sets a cookie signed with
// SESSION_SECRET over the CURRENT code, so replacing the code or turning
// the link off ends every pass made from the old one at once. The pass
// lifts the one-trip limit without an account and unlocks the paid Ask a
// Local; the per-connection rate limits and the daily spend cap still
// apply, so a link that leaks cannot run up more than a day's budget.
//
// Run: npm run test:tester-pass

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Redis } from "@upstash/redis";
import { isUsableSessionSecret } from "./session";

export const TESTER_COOKIE_NAME = "decide_tester";
const CODE_KEY = "tester:code";
/** Long enough for a few months of testing without tapping again. */
export const TESTER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  return isUsableSessionSecret(s) ? s!.trim() : null;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The cookie value for a code, or null without a usable secret. */
export function passFor(code: string): string | null {
  const s = secret();
  return s ? createHmac("sha256", s).update(`tester:${code}`).digest("base64url") : null;
}

export async function currentTesterCode(redis: Redis): Promise<string | null> {
  const code = await redis.get<string>(CODE_KEY);
  return typeof code === "string" && code ? code : null;
}

/** A new link code; the old link and every pass from it stop working. */
export async function newTesterCode(redis: Redis): Promise<string> {
  const code = randomBytes(12).toString("base64url");
  await redis.set(CODE_KEY, code);
  return code;
}

export async function turnOffTesterLink(redis: Redis): Promise<void> {
  await redis.del(CODE_KEY);
}

/** Whether `code` (from the link) is the current one. */
export async function isCurrentCode(redis: Redis, code: string): Promise<boolean> {
  const current = await currentTesterCode(redis);
  return current !== null && same(code, current);
}

/** Whether this request carries a pass for the current code. No cookie
 * costs no Redis read. Never throws: no pass is the safe answer. */
export async function hasTesterPass(redis: Redis, cookie: string | undefined | null): Promise<boolean> {
  if (!cookie) return false;
  try {
    const code = await currentTesterCode(redis);
    const expected = code ? passFor(code) : null;
    return expected !== null && same(cookie, expected);
  } catch {
    return false;
  }
}
