// Lightweight "share my stats" links for comparing visited-countries stats
// with someone else — deliberately NOT a friend-request/social-graph system
// (no requests, no accept/deny, no notifications, no "who are my friends"
// list). Same trust model as a shareable /trip/[jobId] link: the token
// itself, not a login, is what grants viewing access — anyone who has the
// link can see the stats behind it, same as anyone with a trip link can
// view that itinerary. One stable token per email (not reissued each time)
// so a traveler can share it once and reuse it.
//
// Deliberately never exposes the email behind a token in the public-facing
// read (see app/api/stats-share/[token]) — the token is the shareable
// identity, the email stays private, the same way a trip's jobId is
// shareable while nothing about who generated it is.

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
