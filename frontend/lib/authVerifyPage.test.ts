// The sign-in page's two escapes, and the token shape check in front of them.
//
// The bug this covers was a reflected XSS on /api/auth/verify: the token from
// the query string was embedded in an inline <script> via JSON.stringify
// alone, which escapes quotes and backslashes and leaves `</script`
// untouched. Confirmed in the Chromium this environment ships, not argued
// about - the vulnerable template rendered with
//
//   </script><script>document.documentElement.setAttribute('data-pwned','YES')</script>
//
// produced <html data-pwned="YES"> and no marker from the real sign-in
// script; the fixed one produces <html data-original-script-ran="YES"> and no
// data-pwned. Both runs are recorded in lib/authVerifyPage.ts.
//
// The invariant asserted here is the one the browser actually cares about:
// the rendered page contains exactly ONE `</script`, the real terminator.
// That is checked against a battery of payloads rather than one, because the
// first payload tried by hand did NOT fire - it used double quotes, which
// JSON.stringify escapes - and a single-case test would have "proved" the
// hole was closed while it was wide open.
//
// Run: npm run test:auth-verify-page

import {
  escapeHtmlAttr,
  isMagicLinkTokenShape,
  renderVerifyPage,
  scriptStringLiteral,
} from "./authVerifyPage";
import { consumeMagicLinkToken, generateMagicLinkToken, isStorableTokenShape } from "./magicLink";
import { check, finish, heading, section } from "./testutil";

heading("the sign-in page's escaping");

/** Every way out of an inline script element that does not need a double
 * quote or a backslash - the two characters JSON.stringify already handles.
 * Anything relying on those is not a test of this code. */
const BREAKOUTS = [
  "</script><script>x=1</script>",
  "</SCRIPT><script>x=1</script>",
  "</ScRiPt ><script>x=1</script>",
  // The parser closes the element on `</script` followed by whitespace, `>`
  // or `/` - a rule that enumerates cases is a rule with one missing, which
  // is why the fix escapes every `<` instead.
  "</script\t>",
  "</script/>",
  "</script\n>",
  // `<!--` puts the parser into a script-data escaped state where the rules
  // for closing the element change again.
  "<!--<script>",
  "x</script >y",
];

async function main() {
  {
    section("the token shape check, which kills the class");

    // The generator is randomBytes(32).toString("base64url"). Asserted
    // against real output rather than a hand-written sample, so a change to
    // the generator fails here instead of in production sign-in.
    for (let i = 0; i < 20; i++) {
      const real = generateMagicLinkToken();
      check(`a real token is accepted (${real.slice(0, 6)}…)`, isMagicLinkTokenShape(real));
    }

    // Every character that means something in HTML or in a JS string
    // literal is outside the charset.
    for (const bad of [
      ...BREAKOUTS,
      "<",
      ">",
      '"',
      "'",
      "&",
      "\\",
      "a b",
      "a\nb",
      "a b",
      "tok=en",
      "tok.en",
      "tok/en",
      "tok+en",
      "%3Cscript%3E",
      "",
      "short",
      "a".repeat(129),
    ]) {
      check(`refused: ${JSON.stringify(bad).slice(0, 40)}`, isMagicLinkTokenShape(bad) === false);
    }

    // base64url's own alphabet, all of it, so the check cannot be tightened
    // into rejecting real tokens.
    check(
      "the whole base64url alphabet is accepted",
      isMagicLinkTokenShape("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    );
  }

  {
    section("the script-literal escape, on its own");

    // The escape has to hold even without the shape check in front of it -
    // that is the point of having both.
    for (const payload of BREAKOUTS) {
      const literal = scriptStringLiteral(payload);
      check(`no "<" survives: ${JSON.stringify(payload).slice(0, 32)}`, literal.includes("<") === false);
      check("  and no \">\"", literal.includes(">") === false);
    }

    check("a line separator is escaped", scriptStringLiteral("a b").includes("\\u2028"));
    check("  and a paragraph separator", scriptStringLiteral("a b").includes("\\u2029"));
    check(
      "  as escape sequences, not the raw characters",
      scriptStringLiteral("a b").includes(" ") === false
    );

    // Still a valid JS string literal that evaluates back to the input -
    // an escape that mangled the token would break sign-in instead.
    for (const value of [...BREAKOUTS, generateMagicLinkToken(), "plain", 'quote"and\\slash', "a b"]) {
      const roundTripped = JSON.parse(scriptStringLiteral(value)) as string;
      check(
        `round-trips unchanged: ${JSON.stringify(value).slice(0, 32)}`,
        roundTripped === value,
        JSON.stringify(roundTripped)
      );
    }
  }

  {
    section("the rendered page contains exactly one script terminator");

    // The invariant the browser cares about. A second `</script` anywhere in
    // the output is a closed element and a new parsing context, whatever the
    // characters around it were meant to be.
    const real = generateMagicLinkToken();
    const clean = renderVerifyPage(real);
    check("one terminator on a real token", (clean.match(/<\/script/gi) ?? []).length === 1);
    check("  and the token is in the page", clean.includes(real));

    for (const payload of BREAKOUTS) {
      const html = renderVerifyPage(payload);
      const terminators = (html.match(/<\/script/gi) ?? []).length;
      check(
        `one terminator for ${JSON.stringify(payload).slice(0, 34)}`,
        terminators === 1,
        `found ${terminators}`
      );
      // And nothing smuggled through the attribute either. `<` must not
      // appear raw anywhere in the document except the tags the template
      // itself writes - checked as "no `<script` beyond the one".
      check("  and one script opener", (html.match(/<script/gi) ?? []).length === 1);
    }
  }

  {
    section("the attribute escape, which was already right");

    const escaped = escapeHtmlAttr(`</script>"'&<>`);
    check("quotes are escaped", escaped.includes('"') === false && escaped.includes("'") === false);
    check("angle brackets are escaped", escaped.includes("<") === false && escaped.includes(">") === false);
    check("ampersand first, so entities are not double-built", escapeHtmlAttr("&lt;") === "&amp;lt;");
  }

  {
    section("the vulnerable version, kept and run");

    // The difference between the two IS the fix, so the old expression is
    // here and executed rather than described. If this ever stops being
    // true, the assertion below is what says so.
    const payload = "</script><script>x=1</script>";
    const old = JSON.stringify(payload);
    check("JSON.stringify alone leaves </script> intact", old.includes("</script>"));
    check("  which is a second terminator in the page", (old.match(/<\/script/gi) ?? []).length === 2);
    check("while the fixed escape leaves none", (scriptStringLiteral(payload).match(/<\/script/gi) ?? []).length === 0);

    // And the trap that made the hole look closed on the first attempt.
    const withQuotes = `</script><script>document.documentElement.setAttribute("x","y")</script>`;
    check(
      "a payload using double quotes is neutered by JSON.stringify's own escaping",
      JSON.stringify(withQuotes).includes('\\"')
    );
    check(
      "  but it still smuggles the terminator, which is the actual defect",
      JSON.stringify(withQuotes).includes("</script>")
    );
  }

  {
    section("the SECOND lock on the same door, which was only on the GET");

    // The GET handler refuses a token that cannot have come from the
    // generator, and says why in its own words: "there is nothing to lose
    // by refusing it here rather than discovering it is unknown one Redis
    // round-trip later". The POST is the request that actually reaches
    // Redis and consumes the token, and it had no such check - so an
    // arbitrary-length, arbitrary-character string became a Redis key
    // suffix on an unauthenticated endpoint.
    //
    // Two regexes, deliberately: authVerifyPage owns one because it is
    // about rendering a page safely, magicLink owns the other because it is
    // about what may become a key, and coupling the storage layer to an
    // HTML concern to save six characters would be the wrong trade. What
    // must hold is that they AGREE, which is asserted here rather than
    // assumed.
    for (let i = 0; i < 20; i++) {
      const real = generateMagicLinkToken();
      check(`the two checks agree on a real token (${real.slice(0, 6)}…)`, isStorableTokenShape(real) === isMagicLinkTokenShape(real));
    }
    const shapes: unknown[] = [
      ...BREAKOUTS,
      "<", ">", '"', "'", "&", "\\", "a b", "a\nb", "tok=en", "tok.en", "tok/en", "tok+en",
      "%3Cscript%3E", "", "short", "a".repeat(129), "a".repeat(128), "a".repeat(16),
      "magiclink:someone@example.com", "*", "?", "[a]", "a\r\nb",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    ];
    for (const shape of shapes) {
      check(
        `and on ${JSON.stringify(shape).slice(0, 34)}`,
        isStorableTokenShape(shape) === isMagicLinkTokenShape(shape as string),
        `${isStorableTokenShape(shape)} vs ${isMagicLinkTokenShape(shape as string)}`
      );
    }

    // Non-strings reach the storage check from a form body; the render
    // check is only ever handed a string by its caller.
    for (const value of [null, undefined, 42, {}, [], true]) {
      check(`${JSON.stringify(value) ?? "undefined"} is not storable`, isStorableTokenShape(value) === false);
    }

    // The specific thing the key-suffix guard is for: a value that would
    // otherwise be pasted into `magiclink:${token}`.
    check("a colon is refused", isStorableTokenShape("magiclink:a@b.com") === false);
    check("a newline is refused", isStorableTokenShape("abcdefghijklmnop\nabcdefghijklmnop") === false);
    check("a 10,000-character body is refused", isStorableTokenShape("a".repeat(10_000)) === false);
  }

  {
    section("consuming a token: one command, and none at all for a non-token");

    /** A Redis stand-in that records what it was asked. */
    function fakeRedis(stored: Record<string, string>) {
      const calls: string[] = [];
      return {
        calls,
        client: {
          async getdel<T>(key: string): Promise<T | null> {
            calls.push(`getdel ${key}`);
            const value = stored[key];
            delete stored[key];
            return (value as T) ?? null;
          },
          async get<T>(key: string): Promise<T | null> {
            calls.push(`get ${key}`);
            return (stored[key] as T) ?? null;
          },
          async del(key: string): Promise<number> {
            calls.push(`del ${key}`);
            return delete stored[key] ? 1 : 0;
          },
        },
      };
    }

    const token = generateMagicLinkToken();

    {
      const r = fakeRedis({ [`magiclink:${token}`]: "robbie@example.com" });
      const email = await consumeMagicLinkToken(r.client as never, token);
      check("a real token returns its email", email === "robbie@example.com", String(email));
      // GETDEL, not GET-then-DEL: two POSTs arriving together both read the
      // email before either delete landed, and both minted a session. Same
      // email, so nothing escalates - but the file claimed "a token can
      // never be replayed", and that was not quite true.
      check("  in ONE command", r.calls.length === 1, JSON.stringify(r.calls));
      check("  and that command is getdel", r.calls[0].startsWith("getdel "), r.calls[0]);
    }

    {
      // Single-use, for real: the second attempt gets nothing.
      const store = { [`magiclink:${token}`]: "robbie@example.com" };
      const r = fakeRedis(store);
      await consumeMagicLinkToken(r.client as never, token);
      const again = await consumeMagicLinkToken(r.client as never, token);
      check("a consumed token cannot be used twice", again === null, String(again));
    }

    {
      // The point of the shape check: a non-token never becomes a key.
      const r = fakeRedis({});
      for (const bad of ["", "short", "a".repeat(10_000), "magiclink:a@b.com", "tok en"]) {
        const email = await consumeMagicLinkToken(r.client as never, bad);
        check(`${JSON.stringify(bad).slice(0, 26)} yields no email`, email === null);
      }
      check("and reached Redis zero times", r.calls.length === 0, JSON.stringify(r.calls));
    }

    {
      // A well-shaped token that simply is not ours: one round-trip, no email.
      const r = fakeRedis({});
      const email = await consumeMagicLinkToken(r.client as never, "a".repeat(43));
      check("an unknown but well-shaped token yields no email", email === null);
      check("  after exactly one round-trip", r.calls.length === 1, JSON.stringify(r.calls));
    }
  }

  finish();
}

main();
