// One-time magic-link tokens, stored in the same Upstash Redis instance as
// everything else (jobs, rate limits, user records) — no new infra. A token
// is a random opaque string mapped to the email it was issued for, single-use
// (deleted on verify) and short-lived (15 min — long enough to go check an
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

/** Consumes the token: returns the email it was issued for, or null if it
 * doesn't exist/already expired/already used. Deletes it either way it's
 * found so a token can never be replayed. */
export async function consumeMagicLinkToken(redis: Redis, token: string): Promise<string | null> {
  const key = tokenKey(token);
  const email = await redis.get<string>(key);
  if (!email) return null;
  await redis.del(key);
  return email;
}
