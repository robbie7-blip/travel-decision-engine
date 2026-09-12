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
  SESSION_COOKIE_NAME,
  createSessionCookieValue,
  isUsableSessionSecret,
  verifySessionCookieValue,
} from "./session";
import { checkFrontendEnv, verdictFor, type CheckedEnv } from "./health";
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
    // A cookie whose payload is valid and signed but out of date.
    const expired = Buffer.from(
      JSON.stringify({ email: "a@b.com", exp: Math.floor(Date.now() / 1000) - 60 })
    ).toString("base64url");
    const signed = withSecret(STRONG, () => {
      // Re-sign the expired body with the real secret, which is exactly
      // what an old cookie in a browser is.
      const issued = createSessionCookieValue("a@b.com");
      return `${expired}.${issued.split(".")[1]}`;
    });
    check("an expired cookie is refused", withSecret(STRONG, () => verifySessionCookieValue(signed)) === null);
  }

  {
    // No secret at all must be signed-out, not a 500, on every request that
    // merely wants to know who someone is.
    const r = threw(() => withSecret(undefined, () => verifySessionCookieValue("a.b")));
    check("verify with no secret does not throw", r.threw === false, r.message);
    check("and reads as signed out", withSecret(undefined, () => verifySessionCookieValue("a.b")) === null);
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
