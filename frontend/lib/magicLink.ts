// One-time magic-link tokens, stored in the same Upstash Redis instance as
// everything else (jobs, rate limits, user records) - no new infra. A token
// is a random opaque string mapped to the email it was issued for, single-use
// (deleted on verify) and short-lived (15 min - long enough to go check an
// inbox, short enough that a leaked/forwarded email link doesn't stay a
// standing risk).

import { randomBytes } from "crypto";
import type { Redis } from "@upstash/redis";

const TOKEN_TTL_SECONDS = 60 * 15;

function tokenKey(token: string): string {
  return `magiclink:${token}`;
}

export function generateMagicLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function storeMagicLinkToken(redis: Redis, token: string, email: string): Promise<void> {
  await redis.set(tokenKey(token), email, { ex: TOKEN_TTL_SECONDS });
}

/** Whether a string could have come from generateMagicLinkToken.
 *
 * Checked BEFORE the key is built, which is the same argument
 * app/api/auth/verify's GET handler already makes for itself in as many
 * words: "a token that cannot have come from generateMagicLinkToken is not
 * a token, so there is nothing to lose by refusing it here rather than
 * discovering it is unknown one Redis round-trip later." That guard was on
 * the GET, which only RENDERS - and missing from the POST, which is the
 * request that actually reaches Redis and consumes the token.
 *
 * So an arbitrary-length, arbitrary-character string became a Redis key
 * suffix on an unauthenticated endpoint. It can only ever miss, because the
 * `magiclink:` prefix is prepended rather than appended - the cost is a
 * pointless round-trip on whatever a caller chooses to send, which is the
 * same shape the anonymous share-token read had.
 *
 * Deliberately NOT imported from lib/authVerifyPage.ts, which owns the
 * identical regex: that module is about rendering a page safely and this
 * one is about what may become a key. Sharing it would couple the storage
 * layer to an HTML concern. The two agreeing is asserted in the suite. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export function isStorableTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_SHAPE.test(token);
}

/** Consumes the token: returns the email it was issued for, or null if it
 * doesn't exist/already expired/already used.
 *
 * GETDEL, not GET-then-DEL. The header above says a token is "single-use
 * (deleted on verify)" and the old comment here said "a token can never be
 * replayed" - and with two round-trips that was not quite true: two POSTs
 * arriving together both read the email before either delete landed, and
 * both minted a session. Same email, so nothing escalates, but the file
 * claimed a property it did not have. One command makes the claim true.
 *
 * The shape check is what makes the round-trip itself conditional. */
export async function consumeMagicLinkToken(redis: Redis, token: string): Promise<string | null> {
  if (!isStorableTokenShape(token)) return null;
  return (await redis.getdel<string>(tokenKey(token))) ?? null;
}
