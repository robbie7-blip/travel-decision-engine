// Lightweight "share my stats" links for comparing visited-countries stats
// with someone else - deliberately NOT a friend-request/social-graph system
// (no requests, no accept/deny, no notifications, no "who are my friends"
// list). Same trust model as a shareable /trip/[jobId] link: the token
// itself, not a login, is what grants viewing access - anyone who has the
// link can see the stats behind it, same as anyone with a trip link can
// view that itinerary. One stable token per email (not reissued each time)
// so a traveler can share it once and reuse it.
//
// Deliberately never exposes the email behind a token in the public-facing
// read (see app/api/stats-share/[token]) - the token is the shareable
// identity, the email stays private, the same way a trip's jobId is
// shareable while nothing about who generated it is.
//
// The tracker itself no longer requires signing in (see lib/localVisited.ts)
// so this file also supports an anonymous counterpart below: instead of a
// server-issued token tied to an email, the client mints its own token and
// this just stores/refreshes a point-in-time snapshot of the codes under
// it. Same trust model, one less identity (no email) behind it.

import { randomBytes } from "crypto";
import type { Redis } from "@upstash/redis";

function tokenForEmailKey(email: string): string {
  return `statsShareToken:${email.toLowerCase().trim()}`;
}

function emailForTokenKey(token: string): string {
  return `statsShareEmail:${token}`;
}

export async function getOrCreateShareToken(redis: Redis, email: string): Promise<string> {
  const existing = await redis.get<string>(tokenForEmailKey(email));
  if (existing) return existing;

  const token = randomBytes(12).toString("base64url");
  await redis.set(tokenForEmailKey(email), token);
  await redis.set(emailForTokenKey(token), email.toLowerCase().trim());
  return token;
}

export async function getEmailForShareToken(redis: Redis, token: string): Promise<string | null> {
  return (await redis.get<string>(emailForTokenKey(token))) ?? null;
}

function snapshotKey(token: string): string {
  return `statsShareSnapshot:${token}`;
}

// A snapshot isn't a live account - there's no email to reclaim it by, so
// unlike the signed-in path above it needs an expiry rather than living
// forever. ~13 months: long enough that a link shared once stays good for
// a good while, without pretending this is permanent storage.
const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 400;

/** Anonymous counterpart to getOrCreateShareToken - the caller (an
 * unauthenticated device, via lib/localVisited.ts) already minted its own
 * token, so this just persists/refreshes the snapshot of codes behind it.
 * Called again on every toggle (see app/api/visited/share) so an
 * already-shared link keeps reflecting the latest list. */
export async function saveAnonymousShareSnapshot(redis: Redis, token: string, codes: string[]): Promise<void> {
  await redis.set(snapshotKey(token), JSON.stringify(codes), { ex: SNAPSHOT_TTL_SECONDS });
}

/** Whether a caller-supplied share token is shaped like one this product
 * issues.
 *
 * The POST that stores an anonymous snapshot took any string of 1-128
 * characters, with a comment saying a format check was unnecessary because
 * the token is "an opaque client-generated ID". Two things follow from not
 * checking it, and neither is about parsing.
 *
 * It becomes a Redis key suffix - `statsShareSnapshot:${token}` - so
 * whatever arrives, colons and newlines included, lands in the keyspace.
 * That is the same key-injection shape getClientIp had.
 *
 * And a one-character token is accepted, which matters because the token is
 * the ONLY access control on the snapshot behind it. A minimum length is
 * what makes guessing another device's token impractical, and it is also
 * what stops a browser with no CSPRNG (see mintShareToken in
 * localVisited.ts) from storing everyone's list under the same short
 * string.
 *
 * Both real issuers land inside this: the signed-in path is
 * randomBytes(12).toString("base64url"), 16 base64url characters, and a
 * device mints 32 hex characters. */
const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidShareToken(token: unknown): token is string {
  return typeof token === "string" && SHARE_TOKEN.test(token);
}

export async function getAnonymousShareSnapshot(redis: Redis, token: string): Promise<string[] | null> {
  const raw = await redis.get<string | string[]>(snapshotKey(token));
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}
