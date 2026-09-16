// The admin gate's credential handling, pulled out of middleware.ts so it
// can be tested.
//
// THREE THINGS WERE WRONG, and the first one is the only reason the other
// two matter.
//
// NOTHING LIMITED THE GUESSING. `/admin/*` and `/api/admin/*` compare a
// submitted password against ADMIN_PASSWORD and return 401, with no record
// that an attempt happened. Every other credential-ish surface in this app
// is rate limited - sign-in links, generation, feedback, trip questions,
// flight import, the anonymous share write - and the one that is a bare
// shared password was not, so an attacker could try it as fast as the
// network allows, indefinitely, with nothing logged. What is behind it is
// not just curation: /admin/feedback lists travellers' own feedback text and
// itinerary items, and the same value is the test-mode key that
// /api/generate accepts to SKIP the daily spend cap and every rate limit -
// so a guessed password spends the owner's Anthropic money without bound.
//
// THE COMPARE WAS `password === expected`. /api/generate checks the same
// secret with timingSafeEqual and says why in its own comment - "this is a
// real authorization check (bypasses rate limits AND the daily spend cap),
// not just a UI toggle" - while the primary gate on that secret used `===`,
// which returns as soon as two characters differ. A remote timing attack
// across HTTP is genuinely hard, so this is the least urgent of the three;
// it is also free, and the inconsistency is the kind that gets copied.
//
// AND /admin/health SAID NOTHING ABOUT IT. The page whose whole job is
// naming what is quietly wrong did not list ADMIN_PASSWORD at all, so a
// two-character admin password had nowhere to show up. It reports the same
// way SESSION_SECRET does now: a boolean, never the value and never its
// length.
//
// Edge-safe by construction. Middleware runs on the Edge runtime, which has
// no node:crypto - hence WebCrypto below, and no Buffer anywhere.
//
// Run: npm run test:admin-auth

/** The floor on ADMIN_PASSWORD, in characters.
 *
 * Lower than MIN_SESSION_SECRET_CHARS (32) on purpose, and the difference is
 * the attack. A short SESSION_SECRET is guessable OFFLINE - one cookie and a
 * GPU, no rate limit, nothing logged - so 32 there is not conservative. This
 * password can only be guessed ONLINE, one request at a time, against a
 * limiter; 16 random characters is already hopeless at any rate the network
 * allows.
 *
 * Deliberately NOT enforced by refusing. session.ts refuses to mint a
 * session under a weak secret because the alternative is issuing a forgeable
 * credential. Here the alternative is locking the owner out of their own
 * tool over a password that is merely mediocre and no longer brute-forceable
 * anyway, on a deployment that has one already set. So this reports, on
 * /admin/health, where the owner will see it. */
export const MIN_ADMIN_PASSWORD_CHARS = 16;

/** Whether ADMIN_PASSWORD is long enough to be worth the limiter in front
 * of it. Exported so /admin/health can say "set, but too weak" WITHOUT
 * reading a character of it - it reports the boolean, never the length,
 * since a length narrows the keyspace for whoever is guessing. */
export function isUsableAdminPassword(secret: string | undefined | null): boolean {
  return typeof secret === "string" && secret.length >= MIN_ADMIN_PASSWORD_CHARS;
}

/** The password out of an `Authorization: Basic ...` header, or null.
 *
 * Reproduces middleware's existing decoding EXACTLY, including the parts
 * that look odd, because changing them would lock the owner out of a tool
 * they already have a working password for:
 *
 *   - the username is ignored entirely (any username works, as the README
 *     says), so everything after the FIRST colon is the password and a
 *     password containing colons survives;
 *   - atob, not Buffer, because the Edge runtime has no Buffer. That means
 *     Latin-1 bytes, which is what a browser sends for an ASCII password;
 *   - a header that is not valid base64 makes atob throw, which is caught
 *     here and reported as "no credential" rather than as a server error.
 *
 * Returns null for absent, wrong-scheme, undecodable, or colon-less
 * headers. An empty password is null too: `!expected` already refuses an
 * empty ADMIN_PASSWORD, so "" can never be a correct answer and treating it
 * as a credential would only spend a limiter slot. */
export function basicAuthPassword(header: string | null | undefined): string | null {
  if (!header || !header.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  const password = decoded.slice(colon + 1);
  return password.length > 0 ? password : null;
}

/** Whether two secrets match, without leaking where they stop matching.
 *
 * Compares SHA-256 DIGESTS rather than the strings, which is the standard
 * way to do this without node:crypto's timingSafeEqual: the digests are
 * always 32 bytes, so neither the length of the submitted password nor the
 * length of the real one affects the work done, and the XOR-accumulating
 * loop below touches all 32 either way. What a timing difference could
 * reveal is a property of the digest, and recovering the password from that
 * needs a preimage.
 *
 * Async because WebCrypto is. That is fine here: it runs once per request
 * to an admin path, and the alternative on the Edge runtime is a hand-rolled
 * compare that has to reason about string length itself. */
export async function secretsMatch(submitted: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(submitted)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false; // cannot happen with one algorithm
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
