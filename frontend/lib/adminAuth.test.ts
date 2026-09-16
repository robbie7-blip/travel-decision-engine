// The admin gate - the credential handling and the policy around it.
//
// The gate on /admin/* was the one credential surface in this app with
// NOTHING limiting the guessing. Every other one is rate limited - sign-in
// links, generation, feedback, trip questions, flight import, the anonymous
// share write - and this one compared a password, answered 401, and recorded
// nothing, so it could be tried as fast as the network allows, forever, with
// nothing in any log. "Deliberately minimal - a single-owner internal tool"
// is the right shape for the UI and was never a reason for that.
//
// What is behind it is not only curation. /admin/feedback lists travellers'
// own feedback text and the itinerary items they rated, and the same value
// is the test-mode key /api/generate accepts to SKIP the daily spend cap and
// every rate limit - so a guessed password also spends the owner's Anthropic
// money without bound.
//
// Two smaller things came with it. The compare was `password === expected`,
// while /api/generate checks the same secret with timingSafeEqual and says
// why in its own comment. And /admin/health - the page whose whole job is
// naming what is quietly wrong - did not list ADMIN_PASSWORD at all, so a
// two-character admin password had nowhere to appear.
//
// The decoding assertions matter as much as the security ones: this runs in
// front of a tool the owner already has a working password for, and a
// "safer" parse that rejects their existing credential locks them out of
// their own site.
//
// Run: npm run test:admin-auth

import {
  basicAuthPassword,
  isUsableAdminPassword,
  MIN_ADMIN_PASSWORD_CHARS,
  secretsMatch,
} from "./adminAuth";
import { check, finish, heading, section } from "./testutil";

heading("the admin gate");

/** A Basic header the way a browser builds one. */
const basic = (user: string, password: string): string =>
  `Basic ${btoa(`${user}:${password}`)}`;

async function main() {
  {
    section("the header a real browser sends");

    check("an ordinary credential decodes", basicAuthPassword(basic("admin", "hunter2")) === "hunter2");
    // The username is ignored entirely - the README says "any username
    // works" - so this has to hold for every one of them.
    check("any username works", basicAuthPassword(basic("", "hunter2")) === "hunter2");
    check("  including a long one", basicAuthPassword(basic("robbie@example.com", "hunter2")) === "hunter2");
    // Everything after the FIRST colon is the password, which is what makes
    // a password containing colons survive. Splitting on every colon and
    // rejoining did this too; it is asserted so a "tidier" parse cannot
    // quietly break it.
    check("a password with colons survives whole", basicAuthPassword(basic("admin", "a:b:c")) === "a:b:c");
    check("  even one that is only colons", basicAuthPassword(basic("admin", ":::")) === ":::");
    check("spaces and punctuation survive", basicAuthPassword(basic("admin", "a b/c=d+e")) === "a b/c=d+e");
    check("a base64url-looking password survives", basicAuthPassword(basic("x", "Zm9vYmFy-_=")) === "Zm9vYmFy-_=");
  }

  {
    section("headers that are not credentials");

    check("absent", basicAuthPassword(null) === null);
    check("undefined", basicAuthPassword(undefined) === null);
    check("empty", basicAuthPassword("") === null);
    check("a Bearer token is not a Basic credential", basicAuthPassword("Bearer abcdef") === null);
    check("nor a bare value", basicAuthPassword("hunter2") === null);
    // Case matters in the scheme here because it did before, and this file
    // must not change who can get in.
    check("the scheme is matched as-is", basicAuthPassword(`basic ${btoa("a:b")}`) === null);

    // atob throws on these. It used to be caught and fall through to the
    // 401; it still is, and is reported as "no credential" rather than
    // becoming a server error.
    for (const bad of ["Basic !!!!", "Basic ====", "Basic a", "Basic "]) {
      let threw = false;
      let out: string | null = "not-null";
      try {
        out = basicAuthPassword(bad);
      } catch {
        threw = true;
      }
      check(`${JSON.stringify(bad)} does not throw`, threw === false);
      check("  and is no credential", out === null, String(out));
    }

    // No colon at all is not a Basic payload.
    check("a payload with no colon", basicAuthPassword(`Basic ${btoa("justapassword")}`) === null);
    // An empty password can never be right: middleware refuses an empty
    // ADMIN_PASSWORD before it looks at the request, so treating "" as a
    // credential would only spend a limiter slot.
    check("an empty password is no credential", basicAuthPassword(basic("admin", "")) === null);
  }

  {
    section("the compare does not leak where it stops matching");

    const secret = "correct-horse-battery-staple";
    check("identical secrets match", (await secretsMatch(secret, secret)) === true);
    check("a different secret does not", (await secretsMatch("wrong", secret)) === false);
    // The cases `===` answers fastest, which is what a timing attack reads.
    check("differing in the first character", (await secretsMatch("Xorrect-horse-battery-staple", secret)) === false);
    check("differing in the last", (await secretsMatch("correct-horse-battery-stapleX", secret)) === false);
    check("a prefix of the real one", (await secretsMatch("correct-horse", secret)) === false);
    check("the real one plus a character", (await secretsMatch(secret + "!", secret)) === false);
    check("empty against a real secret", (await secretsMatch("", secret)) === false);
    check("case matters", (await secretsMatch(secret.toUpperCase(), secret)) === false);

    // Non-ASCII, because TextEncoder gives UTF-8 and atob gives Latin-1
    // bytes - so a non-ASCII password can round-trip differently. Asserted
    // rather than assumed: whatever the browser sends, the same string must
    // match itself.
    check("a non-ASCII secret matches itself", (await secretsMatch("парола-която-е-дълга", "парола-която-е-дълга")) === true);
    check("  and not a near-miss", (await secretsMatch("парола-която-е-дългa", "парола-която-е-дълга")) === false);

    // Length is not compared separately, so a very long submission is
    // answered by the same fixed 32-byte comparison as a short one.
    check("a 100,000-character submission is simply wrong", (await secretsMatch("a".repeat(100_000), secret)) === false);
  }

  {
    section("how weak is too weak to leave unmentioned");

    check("a generated password passes", isUsableAdminPassword("k3Hn2pQvXr8sLm4T"), "16 chars");
    check("  as does a long one", isUsableAdminPassword("a".repeat(40)));
    check("exactly the floor passes", isUsableAdminPassword("a".repeat(MIN_ADMIN_PASSWORD_CHARS)));
    check("one under does not", isUsableAdminPassword("a".repeat(MIN_ADMIN_PASSWORD_CHARS - 1)) === false);
    check('"changeme" does not', isUsableAdminPassword("changeme") === false);
    check("a two-character password does not", isUsableAdminPassword("ab") === false);
    check("empty does not", isUsableAdminPassword("") === false);
    check("unset does not", isUsableAdminPassword(undefined) === false);
    check("null does not", isUsableAdminPassword(null) === false);
    check("a non-string does not", isUsableAdminPassword(42 as unknown as string) === false);

    // The floor is LOWER than SESSION_SECRET's 32, and the difference is the
    // attack, not a lapse: that one is guessable offline from one cookie
    // with no limiter, this one only online against one.
    check("the floor is below the session secret's", MIN_ADMIN_PASSWORD_CHARS < 32, String(MIN_ADMIN_PASSWORD_CHARS));

    // And it does NOT lock anyone out. Weakness is reported on
    // /admin/health; nothing here refuses a request.
    check("a weak password is still a usable credential", (await secretsMatch("ab", "ab")) === true);
  }

  finish();
}

main();
