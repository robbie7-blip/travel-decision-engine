// Signed session cookie for the magic-link auth system - deliberately no
// server-side session store (no new infra beyond the Redis already in use
// for jobs/rate-limits/user records). The cookie itself carries the email +
// expiry, HMAC-signed with SESSION_SECRET so a client can't forge or extend
// it. Verifying is a pure function of the cookie + the secret - no Redis
// round-trip needed on every request that just needs "who is this."
//
// Node-only (crypto.timingSafeEqual/createHmac): every route that reads or
// writes this cookie must run on the Node runtime (`export const runtime =
// "nodejs"`), not Edge - same reasoning /api/generate already documents for
// why it isn't Edge.

import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "decide_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  email: string;
  exp: number; // epoch seconds
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set - accounts/subscriptions are unconfigured.");
  }
  return secret;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Builds the cookie value for a freshly-authenticated email. Callers set
 * this as an httpOnly, secure, sameSite=lax cookie named SESSION_COOKIE_NAME. */
export function createSessionCookieValue(email: string): string {
  const payload: SessionPayload = { email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = getSecret();
  return `${body}.${sign(body, secret)}`;
}

/** Verifies a cookie value and returns the email, or null if missing,
 * malformed, expired, or tampered with. Never throws on bad input - this is
 * called on every request that touches account state, so a garbage cookie
 * (stale format, cleared secret) should read as "logged out," not 500. */
export function verifySessionCookieValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.email;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
