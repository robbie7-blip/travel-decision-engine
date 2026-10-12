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

/** How much of a session has to be used up before it is extended.
 *
 * WHY A SESSION IS EXTENDED AT ALL. The cookie was issued once, at
 * sign-in, with an absolute thirty-day expiry, and nothing ever touched it
 * again. So "stay signed in" actually meant "signed in until thirty days
 * after the day you clicked the link" - and then signed out mid-use, with
 * no warning and no regard for how much the site had been used in the
 * meantime. Someone who opens this every week got thrown out just the
 * same as someone who signed in once and never came back.
 *
 * Every request that asks who somebody is now also extends their session,
 * so a traveler who keeps using the site is never signed out. Thirty days
 * is the gap after which they are asked for their email again, not a
 * countdown from the first time they ever signed in.
 *
 * NOT ON EVERY REQUEST, though, which is what this constant is for.
 * /api/account is fetched from the header of every page, so re-issuing on
 * each one would put a Set-Cookie on every page view to move an expiry by
 * a few seconds. A day of slack is invisible to the traveler and makes
 * this at most one extra header a day per browser. */
const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24; // 1 day

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

/** The verified contents of a cookie, or null if missing, malformed,
 * expired, or tampered with. Never throws on bad input - this is reached on
 * every request that touches account state, so a garbage cookie (stale
 * format, cleared secret) must read as "logged out," not 500. */
function readPayload(value: string | undefined | null): SessionPayload | null {
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
    return payload;
  } catch {
    return null;
  }
}

/** Verifies a cookie value and returns the email, or null. */
export function verifySessionCookieValue(value: string | undefined | null): string | null {
  return readPayload(value)?.email ?? null;
}

/** A fresh cookie value for a session that is still valid but has been
 * running a while, or null when there is nothing to do - which is the
 * common case, and is why this is cheap enough to call on every request.
 *
 * Null covers all of: no cookie, a cookie that does not verify, one that
 * has already expired, and one that is simply too new to be worth
 * re-issuing. A caller sets the cookie when it gets a string back and
 * leaves it alone otherwise; it must NOT sign anybody out on null, because
 * "nothing to renew" and "not signed in" both land here. Ask
 * verifySessionCookieValue who somebody is; ask this only whether to hand
 * them a longer-lived cookie.
 *
 * Deliberately swallows a bad SESSION_SECRET rather than throwing: an
 * unsignable secret is already reported by /admin/health and already
 * refuses sign-in loudly in createSessionCookieValue, and a renewal that
 * cannot happen must never take down the request it was riding along on. */
export function renewSessionCookieValue(value: string | undefined | null): string | null {
  const payload = readPayload(value);
  if (!payload) return null;
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  if (remaining > SESSION_TTL_SECONDS - SESSION_RENEW_AFTER_SECONDS) return null;
  try {
    return createSessionCookieValue(payload.email);
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;

/** The attributes this cookie is set with, in one place.
 *
 * It is set from three routes now (sign-in, renewal, sign-out) and they
 * have to agree: a cookie re-issued with a different path or sameSite is a
 * SECOND cookie rather than a replacement, and the browser then sends both
 * and picks between them by rules nobody wants to depend on.
 *
 * `secure` is read at call time rather than frozen into a constant so a
 * local http://localhost run still gets a usable cookie.
 *
 * httpOnly: the only thing that reads this is the server, and a session
 * credential that JavaScript can read is one an XSS can take. sameSite
 * lax: the magic-link email is a cross-site navigation INTO this site, so
 * strict would hand someone a cookie they then arrive without. */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: "/";
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  };
}
