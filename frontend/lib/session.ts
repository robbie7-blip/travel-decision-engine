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

/** The floor on SESSION_SECRET, in characters.
 *
 * 32 because that is what the README already tells the owner to generate
 * (`openssl rand -base64 32`, which produces 44), so a correctly configured
 * deployment is nowhere near this line.
 *
 * The check exists because `if (!secret)` accepted ANY non-empty value, and
 * a short one is not a weaker version of this scheme - it is no scheme at
 * all. The cookie is `base64url(payload).hmacSha256(payload, secret)` and
 * the payload is public (it is the visitor's own cookie), so anyone holding
 * one cookie can test candidate secrets offline, as fast as their hardware
 * computes HMAC, with no rate limit and nothing logged. A secret of a
 * handful of characters - "secret", "changeme", "decide", a value typed in
 * a hurry to get sign-in working - falls in seconds. What they get is not
 * one account: it is the ability to MINT a valid cookie for any email at
 * all, including an address in PRO_OVERRIDE_EMAILS, which resolvePlan
 * grants paid access to with no Stripe record behind it.
 *
 * And nothing would have said so. /admin/health reports presence only -
 * correctly, it must never print a secret - so a one-character
 * SESSION_SECRET showed there as "set", on the one page whose whole job is
 * naming what is quietly wrong.
 *
 * The consequence of the floor is deliberate and visible rather than
 * silent: with a too-short secret, sign-in REFUSES (the verify route
 * already catches this throw, logs it by name and redirects to
 * ?error=server) instead of issuing a forgeable cookie, and existing
 * cookies read as signed out. Refusing to mint a credential that cannot be
 * trusted is the right failure; it is recoverable by setting one
 * environment variable, and the message says which. */
export const MIN_SESSION_SECRET_CHARS = 32;

/** Whether a SESSION_SECRET is long enough to sign with. Exported so
 * /admin/health can say "set, but too short to trust" WITHOUT reading a
 * character of it - the page's own rule. It reports the boolean, never the
 * length: a length narrows the keyspace for whoever is guessing. */
export function isUsableSessionSecret(secret: string | undefined | null): boolean {
  return typeof secret === "string" && secret.trim().length >= MIN_SESSION_SECRET_CHARS;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set - accounts/subscriptions are unconfigured.");
  }
  if (!isUsableSessionSecret(secret)) {
    throw new Error(
      `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_CHARS} characters, which is short enough ` +
        "to guess offline from any one session cookie - and a guessed secret mints a valid session " +
        "for ANY email, including a PRO_OVERRIDE_EMAILS address. Sign-in is refused rather than " +
        "issuing a cookie that cannot be trusted. Generate one with `openssl rand -base64 32`."
    );
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
