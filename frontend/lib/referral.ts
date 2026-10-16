// "Invite a friend, get a free trip." Every account has an invite link,
// /r/<code> (app/r/[code]/route.ts), which drops the code in a cookie. When
// the friend then makes their first trip signed in, both accounts get one
// bonus trip: spent after the monthly allowance runs out, and kept until
// spent.
//
// What stops it being farmed: a friend counts once, ever, and only on a
// first trip (no trip of theirs this month or in the archive); nobody can
// invite themselves; and an inviter earns at most REFERRAL_MONTHLY_CAP a
// month. A new address already comes with a free monthly allowance, so
// an invite adds one trip to what making accounts would give anyway.
//
// Codes are random, not derived from the address: the link is shared, and
// it must not say whose it is.
//
// Run: npm run test:referral

import { randomBytes } from "node:crypto";

export const REFERRAL_COOKIE_NAME = "decide_ref";
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 3600;
export const REFERRAL_MONTHLY_CAP = 5;

/** The subset of the Upstash client this file uses, so a test can stand in. */
export interface ReferralRedis {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  incrby(key: string, by: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const CODE_RE = /^[a-z2-9]{8}$/;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o, 1/l

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && CODE_RE.test(value);
}

function normal(email: string): string {
  return email.toLowerCase().trim();
}

const codeKey = (code: string) => `ref:code:${code}`;
const ownCodeKey = (email: string) => `ref:own:${normal(email)}`;
const friendKey = (email: string) => `ref:friend:${normal(email)}`;
const joinedKey = (email: string) => `ref:joined:${normal(email)}`;
const earnedKey = (email: string, month: string) => `ref:earned:${normal(email)}:${month}`;
export const bonusKey = (email: string) => `bonus:${normal(email)}`;

function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** This account's code, made on first ask and the same ever after. */
export async function referralCodeFor(redis: ReferralRedis, email: string): Promise<string> {
  const existing = await redis.get<string>(ownCodeKey(email));
  if (isReferralCode(existing)) return existing;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if ((await redis.set(codeKey(code), normal(email), { nx: true })) !== "OK") continue;
    // Two tabs asking at once: the first code written wins, and the other
    // tab's code still points at the same account, so either link works.
    await redis.set(ownCodeKey(email), code, { nx: true });
    return (await redis.get<string>(ownCodeKey(email))) ?? code;
  }
  throw new Error("could not make a referral code");
}

export interface ReferralStats {
  joined: number;
  bonus: number;
}

export async function referralStats(redis: ReferralRedis, email: string): Promise<ReferralStats> {
  const [joined, bonus] = await Promise.all([redis.get<number>(joinedKey(email)), redis.get<number>(bonusKey(email))]);
  return { joined: Number(joined) || 0, bonus: Math.max(0, Number(bonus) || 0) };
}

export type ReferralOutcome = "rewarded" | "friend-only" | "no-inviter" | "self" | "already-counted" | "not-first-trip";

/** Called after a signed-in trip is enqueued, when the visitor arrived
 * through an invite link. `firstTrip` is the caller's word that this is the
 * friend's first trip ever (see app/api/generate). */
export async function rewardReferral(
  redis: ReferralRedis,
  input: { friendEmail: string; code: string; firstTrip: boolean; month?: string }
): Promise<ReferralOutcome> {
  if (!isReferralCode(input.code)) return "no-inviter";
  const inviter = await redis.get<string>(codeKey(input.code));
  if (!inviter) return "no-inviter";
  if (normal(inviter) === normal(input.friendEmail)) return "self";
  if (!input.firstTrip) return "not-first-trip";
  // Claimed before anything is granted: a friend counts once, whatever
  // retries or second tabs happen.
  if ((await redis.set(friendKey(input.friendEmail), normal(inviter), { nx: true })) !== "OK") return "already-counted";

  await redis.incrby(bonusKey(input.friendEmail), 1);
  await redis.incr(joinedKey(inviter));
  const month = input.month ?? new Date().toISOString().slice(0, 7);
  const earned = await redis.incr(earnedKey(inviter, month));
  await redis.expire(earnedKey(inviter, month), 40 * 24 * 3600);
  if (earned > REFERRAL_MONTHLY_CAP) return "friend-only";
  await redis.incrby(bonusKey(inviter), 1);
  return "rewarded";
}
