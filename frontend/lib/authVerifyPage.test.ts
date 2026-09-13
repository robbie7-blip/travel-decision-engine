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
import { generateMagicLinkToken } from "./magicLink";
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

function main() {
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

  finish();
}

main();
