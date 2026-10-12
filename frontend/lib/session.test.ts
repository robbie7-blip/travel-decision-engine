// The session cookie - the whole of authentication.
//
// There is no server-side session store. The cookie IS the credential:
// `base64url({email, exp}).hmacSha256(that, SESSION_SECRET)`, and every
// route that asks "who is this" asks this file and nothing else.
//
// Which is why the one line that was missing matters. getSecret() checked
// `if (!secret)` and nothing more, so ANY non-empty SESSION_SECRET signed
// sessions - including "x". The payload half of the cookie is public (it is
// the visitor's own cookie, and it is not even encrypted), so a holder of
// one cookie can test candidate secrets offline at whatever rate their
// hardware computes HMAC-SHA256, with no rate limit and nothing logged.
// What a guessed secret yields is not one account: it is the power to MINT
// a valid cookie for any email at all, including one in
// PRO_OVERRIDE_EMAILS, which resolvePlan turns into paid access with no
// Stripe record behind it.
//
// And /admin/health could not have told anyone, because it reports
// presence and a one-character secret is present. That is the page whose
// entire purpose is naming things that fail quietly.
//
// Run: npm run test:session

import {
  MIN_SESSION_SECRET_CHARS,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  createSessionCookieValue,
  isUsableSessionSecret,
  renewSessionCookieValue,
  sessionCookieOptions,
  verifySessionCookieValue,
} from "./session";
import { checkFrontendEnv, checkSessionHost, verdictFor, type CheckedEnv } from "./health";
import { check, finish, heading, section } from "./testutil";

heading("session cookie");

const STRONG = "ZmFrZS1zZWNyZXQtZm9yLXRlc3Rpbmctb25seS0zMis=";

/** Runs `fn` with SESSION_SECRET set to exactly this. */
function withSecret<T>(secret: string | undefined, fn: () => T): T {
  const bag = process.env as Record<string, string | undefined>;
  const saved = bag.SESSION_SECRET;
  if (secret === undefined) delete bag.SESSION_SECRET;
  else bag.SESSION_SECRET = secret;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete bag.SESSION_SECRET;
    else bag.SESSION_SECRET = saved;
  }
}

/** Runs `fn` with the clock stopped at `atMs`.
 *
 * Needed because everything about a session is a question about time, and
 * none of it can be asked honestly without moving the clock. The expiry
 * test below used to hand-build an out-of-date payload and pair it with a
 * real cookie's signature - which a verifier refuses, but for the WRONG
 * REASON: the signature covers the body, so a swapped body fails on the
 * HMAC long before anything looks at `exp`. That test would have passed
 * with the expiry check deleted. Minting a real cookie in the past and
 * reading it in the present is the only version that tests what it says. */
function withClock<T>(atMs: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => atMs;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The exp inside a cookie, in epoch seconds. Reads the public half, which
 * is what a browser holds: no secret involved. */
function expiryOf(cookie: string): number {
  return (JSON.parse(Buffer.from(cookie.split(".")[0], "base64url").toString("utf8")) as { exp: number }).exp;
}

function threw(fn: () => unknown): { threw: boolean; message: string } {
  try {
    fn();
    return { threw: false, message: "" };
  } catch (e) {
    return { threw: true, message: (e as Error).message };
  }
}

function main() {
  section("a good secret still signs and verifies");

  {
    check("the cookie name is stable", SESSION_COOKIE_NAME === "decide_session", SESSION_COOKIE_NAME);

    const value = withSecret(STRONG, () => createSessionCookieValue("Traveller@Example.com"));
    check("a cookie is issued", typeof value === "string" && value.includes("."), value.slice(0, 24));
    check(
      "and verifies back to the same email",
      withSecret(STRONG, () => verifySessionCookieValue(value)) === "Traveller@Example.com"
    );
  }

  {
    // The point of signing: a cookie minted under one secret must be
    // worthless under another.
    const value = withSecret(STRONG, () => createSessionCookieValue("a@b.com"));
    check(
      "a cookie from a different secret is refused",
      withSecret(`${STRONG}-other`, () => verifySessionCookieValue(value)) === null
    );
  }

  {
    // Tampering with the payload while keeping the old signature.
    const value = withSecret(STRONG, () => createSessionCookieValue("victim@example.com"));
    const [, signature] = value.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ email: "attacker@example.com", exp: Math.floor(Date.now() / 1000) + 999 })
    ).toString("base64url");
    check(
      "a swapped payload is refused",
      withSecret(STRONG, () => verifySessionCookieValue(`${forgedBody}.${signature}`)) === null
    );
  }

  section("shapes that must read as signed out, never throw");

  {
    for (const value of [
      undefined,
      null,
      "",
      ".",
      "..",
      "nodot",
      "body.",
      ".signature",
      "body.signature",
      `${Buffer.from("{}").toString("base64url")}.x`,
      `${Buffer.from("not json").toString("base64url")}.x`,
    ]) {
      const r = threw(() => withSecret(STRONG, () => verifySessionCookieValue(value as string | null)));
      check(`${JSON.stringify(value)} does not throw`, r.threw === false, r.message);
      check(
        "  and reads as signed out",
        withSecret(STRONG, () => verifySessionCookieValue(value as string | null)) === null
      );
    }
  }

  {
    // A REAL cookie, properly signed, issued long enough ago to have run
    // out. Minted with the clock moved back rather than hand-built, so the
    // signature is genuine and `exp` is the only thing wrong with it - see
    // withClock.
    const now = Date.now();
    const old = withClock(now - 31 * DAY_MS, () => withSecret(STRONG, () => createSessionCookieValue("a@b.com")));
    check(
      "a cookie older than its own expiry is refused",
      withClock(now, () => withSecret(STRONG, () => verifySessionCookieValue(old))) === null
    );
    check(
      "and the same cookie verified back when it was issued is fine",
      withClock(now - 31 * DAY_MS, () => withSecret(STRONG, () => verifySessionCookieValue(old))) === "a@b.com"
    );
  }

  {
    // No secret at all must be signed-out, not a 500, on every request that
    // merely wants to know who someone is.
    const r = threw(() => withSecret(undefined, () => verifySessionCookieValue("a.b")));
    check("verify with no secret does not throw", r.threw === false, r.message);
    check("and reads as signed out", withSecret(undefined, () => verifySessionCookieValue("a.b")) === null);
  }

  section("staying signed in");

  // WHAT THIS IS FOR. The cookie was issued once, at sign-in, with an
  // absolute thirty-day expiry, and nothing ever touched it again. So
  // "stay signed in" meant "signed in until thirty days after the day you
  // clicked the link" - and then signed out mid-use, with no warning,
  // however much the site had been used in between. A traveler who opens
  // this every week was thrown out on the same day as one who signed in
  // once and never came back.
  {
    const now = Date.now();
    const mint = (atMs: number) => withClock(atMs, () => withSecret(STRONG, () => createSessionCookieValue("a@b.com")));
    const renew = (cookie: string | null | undefined, atMs: number) =>
      withClock(atMs, () => withSecret(STRONG, () => renewSessionCookieValue(cookie)));

    check("a cookie issued seconds ago is not re-issued", renew(mint(now), now) === null);
    check("nor one issued an hour ago", renew(mint(now - 3600_000), now) === null);

    const weekOld = mint(now - 7 * DAY_MS);
    const renewed = renew(weekOld, now);
    check("one in use a week later IS re-issued", typeof renewed === "string", String(renewed));
    check(
      "to the same person",
      withClock(now, () => withSecret(STRONG, () => verifySessionCookieValue(renewed))) === "a@b.com"
    );
    check(
      "with the full thirty days ahead of it again",
      renewed !== null && expiryOf(renewed) - Math.floor(now / 1000) === SESSION_COOKIE_MAX_AGE_SECONDS,
      renewed === null ? "null" : String(expiryOf(renewed) - Math.floor(now / 1000))
    );
    check(
      "which is later than the one it replaces",
      renewed !== null && expiryOf(renewed) > expiryOf(weekOld)
    );

    // The whole point, stated as the thing someone would notice: use the
    // site every fortnight for a year and you are never asked to sign in
    // again.
    {
      let cookie = mint(now - 365 * DAY_MS);
      let signedOutAt: number | null = null;
      for (let day = 365 - 14; day >= 0; day -= 14) {
        const at = now - day * DAY_MS;
        if (withClock(at, () => withSecret(STRONG, () => verifySessionCookieValue(cookie))) === null) {
          signedOutAt = day;
          break;
        }
        cookie = renew(cookie, at) ?? cookie;
      }
      check("a fortnightly visitor is never signed out over a year", signedOutAt === null, `signed out ${signedOutAt} days ago`);
    }

    // And the other half: stopping counts. Nothing here keeps somebody
    // signed in forever on the strength of one visit.
    {
      const abandoned = mint(now - 365 * DAY_MS);
      check(
        "somebody who signed in a year ago and never came back is signed out",
        withClock(now, () => withSecret(STRONG, () => verifySessionCookieValue(abandoned))) === null
      );
      check("and there is nothing to renew", renew(abandoned, now) === null);
    }

    section("renewal never hands out a session nobody earned");

    check("no cookie renews to nothing", renew(undefined, now) === null);
    check("an empty cookie renews to nothing", renew("", now) === null);
    check("a garbage cookie renews to nothing", renew("not.a.cookie", now) === null);
    {
      // The one that matters: a renewal must verify first. Re-issuing on a
      // forged cookie would turn a failed forgery into a real session.
      const victim = mint(now - 7 * DAY_MS);
      const forgedBody = Buffer.from(
        JSON.stringify({ email: "attacker@example.com", exp: Math.floor(now / 1000) + 60 })
      ).toString("base64url");
      check("a forged cookie renews to nothing", renew(`${forgedBody}.${victim.split(".")[1]}`, now) === null);
      check(
        "a cookie signed with another secret renews to nothing",
        withClock(now, () => withSecret(`${STRONG}-other`, () => renewSessionCookieValue(victim))) === null
      );
    }
    {
      // A renewal rides along on an ordinary request. It must never be the
      // thing that takes one down.
      const weekOldCookie = mint(now - 7 * DAY_MS);
      const r = threw(() => withClock(now, () => withSecret("x", () => renewSessionCookieValue(weekOldCookie))));
      check("an unusable secret does not throw out of a renewal", r.threw === false, r.message);
      check(
        "it simply does not renew",
        withClock(now, () => withSecret("x", () => renewSessionCookieValue(weekOldCookie))) === null
      );
      const absent = threw(() => withClock(now, () => withSecret(undefined, () => renewSessionCookieValue(weekOldCookie))));
      check("and neither does a missing one", absent.threw === false, absent.message);
    }
  }

  section("the attributes all three writers share");

  {
    // Sign-in, renewal and sign-out each set this cookie. A browser
    // replaces a cookie only when the name, domain AND path match, so a
    // renewal written under a different path is a SECOND cookie of the same
    // name rather than a replacement - after which the browser sends both
    // and signing out clears one of them.
    const options = sessionCookieOptions();
    check("the path is the whole site", options.path === "/", options.path);
    check("it outlives the browser session", options.maxAge === SESSION_COOKIE_MAX_AGE_SECONDS, String(options.maxAge));
    check("it is thirty days", options.maxAge === 60 * 60 * 24 * 30, String(options.maxAge));
    check("JavaScript cannot read it", options.httpOnly === true);
    check(
      "and it survives the magic link, which arrives from the mail client",
      options.sameSite === "lax",
      options.sameSite
    );

    const bag = process.env as Record<string, string | undefined>;
    const savedEnv = bag.NODE_ENV;
    try {
      bag.NODE_ENV = "production";
      check("https only in production", sessionCookieOptions().secure === true);
      bag.NODE_ENV = "development";
      check("but usable on a local http run", sessionCookieOptions().secure === false);
    } finally {
      if (savedEnv === undefined) delete bag.NODE_ENV;
      else bag.NODE_ENV = savedEnv;
    }
  }

  section("a secret too short to sign with");

  {
    check(`the floor is ${MIN_SESSION_SECRET_CHARS} characters`, MIN_SESSION_SECRET_CHARS === 32);

    // The values someone actually types to get sign-in working.
    for (const weak of ["x", "secret", "changeme", "decide", "dev", "a".repeat(31), `${"a".repeat(30)}   `]) {
      check(`${JSON.stringify(weak.slice(0, 12))} is not usable`, isUsableSessionSecret(weak) === false);

      // Refusing to ISSUE is the substance: no forgeable cookie is minted.
      const r = threw(() => withSecret(weak, () => createSessionCookieValue("a@b.com")));
      check("  and signing in refuses", r.threw === true);
      check("  naming the length", /32 characters/.test(r.message), r.message.slice(0, 60));
      check("  and how to fix it", /openssl rand -base64 32/.test(r.message), r.message.slice(0, 60));

      // Existing cookies read as signed out rather than 500.
      const good = withSecret(STRONG, () => createSessionCookieValue("a@b.com"));
      const v = threw(() => withSecret(weak, () => verifySessionCookieValue(good)));
      check("  existing cookies do not throw", v.threw === false, v.message);
      check("  they read as signed out", withSecret(weak, () => verifySessionCookieValue(good)) === null);
    }
  }

  {
    for (const ok of [STRONG, "a".repeat(32), "a".repeat(200)]) {
      check(`${ok.length} characters is usable`, isUsableSessionSecret(ok) === true);
    }
    check("undefined is not usable", isUsableSessionSecret(undefined) === false);
    check("an empty string is not usable", isUsableSessionSecret("") === false);
    check("whitespace is not usable", isUsableSessionSecret(" ".repeat(64)) === false);
  }

  section("and /admin/health says so");

  {
    // This is the half that makes the floor findable rather than a mystery
    // 'error=server'. The page reported a one-character secret as "set",
    // because presence was the only question it knew how to ask.
    const sessionCheck = (secret: string | undefined): CheckedEnv | undefined =>
      withSecret(secret, () => checkFrontendEnv().find((c) => c.name === "SESSION_SECRET"));

    const weak = sessionCheck("x");
    check("a short secret is flagged weak", weak?.weak === true, JSON.stringify(weak));
    check("and the verdict is down, not ok", weak !== undefined && verdictFor(weak) === "down", weak && verdictFor(weak));
    check("with a reason naming the fix", /openssl rand -base64 32/.test(weak?.weakBecause ?? ""), weak?.weakBecause);

    // Presence only, never values - the page's own rule. Not the secret,
    // and not its length either, since a length narrows the keyspace.
    const rendered = `${weak?.weakBecause ?? ""} ${weak?.what ?? ""}`;
    check("the reason does not contain the secret", !rendered.includes("x-"), rendered.slice(0, 40));
    check("nor its length", !/\b1 char/.test(rendered), rendered.slice(0, 60));

    const strong = sessionCheck(STRONG);
    check("a good secret is not flagged", strong?.weak === undefined, JSON.stringify(strong?.weak));
    check("and reads ok", strong !== undefined && verdictFor(strong) === "ok", strong && verdictFor(strong));

    const absent = sessionCheck(undefined);
    check("an absent secret is still MISSING, not weak", absent?.present === false && !absent?.weak, JSON.stringify(absent));
    check("and still down", absent !== undefined && verdictFor(absent) === "down", absent && verdictFor(absent));
  }

  section("the hostname a session belongs to");

  // "Why am I thrown out of my account after every update?" A session
  // cookie is host-only - set with no `domain`, so the browser hands it
  // back to exactly the hostname that issued it. Every Vercel deployment
  // also gets its OWN permanent hostname, so reaching the site through the
  // dashboard's link to the latest deployment means a different hostname
  // after every deploy, and a browser with no cookie for it. Nothing is
  // broken and nothing is logged; it just looks like being signed out
  // every time the site is updated. /admin/health is the only thing that
  // can see it, because it is the only place that knows both halves.
  {
    const PROD = "https://yourdecide.com";

    check("the ordinary case says nothing", checkSessionHost("yourdecide.com", PROD) === null);
    check("case does not matter", checkSessionHost("YourDecide.com", PROD) === null);
    check("nor does a missing host header", checkSessionHost(null, PROD) === null);
    check("nor an unparseable site url", checkSessionHost("yourdecide.com", "not a url") === null);

    {
      // The one that is a deploy-by-deploy sign-out.
      const preview = checkSessionHost("decide-9f3a2b1c7-robbie.vercel.app", PROD);
      check("a per-deployment hostname is reported", preview !== null);
      check("  and named as per-deployment", preview?.perDeployment === true, JSON.stringify(preview));
      check("  with both halves to compare", preview?.sessionsBelongTo === "yourdecide.com", preview?.sessionsBelongTo);
    }

    {
      // The permanent version: one address, not a new one each time.
      const www = checkSessionHost("www.yourdecide.com", PROD);
      check("www against the bare domain is reported", www !== null);
      check("  but not as per-deployment", www?.perDeployment === false, JSON.stringify(www));
    }

    {
      // The project's own stable alias is a mismatch worth showing, and it
      // is NOT per-deployment: it points at whatever is live, so a session
      // started on it survives the next deploy.
      const alias = checkSessionHost("decide.vercel.app", PROD);
      check("the project alias is reported", alias !== null);
      check("  but not as per-deployment", alias?.perDeployment === false, JSON.stringify(alias));
    }

    check(
      "a port is part of the hostname, as the browser treats it",
      checkSessionHost("localhost:3001", "http://localhost:3000") !== null
    );
    check(
      "and the matching one is silent",
      checkSessionHost("localhost:3000", "http://localhost:3000") === null
    );
  }

  {
    // verdictFor's ordering: weak is checked before present, because a
    // variable that is set but unusable is worse than an absent one - an
    // absent one announces itself on first use.
    const weakOptional: CheckedEnv = { name: "X", criticality: "optional", what: "", present: true, weak: true };
    check("a weak optional variable warns", verdictFor(weakOptional) === "warn", verdictFor(weakOptional));
    const weakDegrades: CheckedEnv = { name: "X", criticality: "degrades", what: "", present: true, weak: true };
    check("a weak degrading variable is down", verdictFor(weakDegrades) === "down", verdictFor(weakDegrades));
  }

  finish();
}

main();
