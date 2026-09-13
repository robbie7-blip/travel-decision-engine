// The intermediate "Finishing sign-in…" page, and the two escaping rules it
// depends on.
//
// GET /api/auth/verify renders an HTML page with the token from the query
// string embedded twice: once in a hidden form input, and once as a
// JavaScript string literal inside an inline <script> that POSTs it. The
// second one was built with JSON.stringify and nothing else, under a comment
// saying "JSON.stringify handles quote/backslash escaping correctly for that
// context" - which is true, and is the wrong conclusion, because the hazard
// inside an inline <script> is not quotes. It is the seven characters
// `</script`, which JSON.stringify leaves exactly as it finds them.
//
// So a token of
//
//   </script><script>...anything without a double quote or backslash...</script>
//
// closed the real script element early, ran as its own script on the site's
// own origin, and destroyed the legitimate sign-in script on the way past.
// Reflected XSS on the authentication endpoint, reachable by getting somebody
// to open one link.
//
// VERIFIED IN A BROWSER, not reasoned about: the current template rendered
// with that token, loaded in the Chromium this environment ships, set the
// marker attribute the payload asked for (`data-pwned="YES"` on <html>) and
// did NOT set the one the real script sets. A first attempt did not fire,
// which is worth recording because it is the trap in judging this by eye:
// the payload used double quotes, JSON.stringify escaped them to \" and the
// injected script died on a syntax error. Single quotes are untouched. The
// hole is real; only a careless payload makes it look closed.
//
// The same repository already had the correct pattern written down - the
// JSON-LD block in app/destinations/[slug]/page.tsx appends
// `.replace(/</g, "\\u003c")` with three lines of comment explaining this
// exact escape, and calls it defense in depth for inputs that are curated
// and fixed. The auth endpoint, whose input comes from the query string,
// did not have it.
//
// Two layers here, because either alone would be enough and neither is
// worth relying on alone:
//
//   1. The token is refused before anything is rendered unless it has the
//      shape the generator produces. This kills the class rather than the
//      instance, and a token that fails is not a token, so nothing is lost.
//   2. The script-literal escape is correct anyway, so the template stays
//      safe if the validation is ever loosened.
//
// Run: npm run test:auth-verify-page

/** Whether a token could have come from generateMagicLinkToken.
 *
 * That is `randomBytes(32).toString("base64url")`: 43 characters of
 * [A-Za-z0-9_-]. The character class is the security-relevant half and is
 * exact. The length bound is deliberately generous rather than pinned to 43,
 * so changing the token length later cannot silently break sign-in for
 * everybody - the charset alone already excludes every character that means
 * anything in HTML or in a JS string literal.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function isMagicLinkTokenShape(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** A JavaScript string literal safe to place inside an inline <script>.
 *
 * JSON.stringify does the quoting and the control-character escaping; these
 * four replacements do the part it does not:
 *
 *   <  >   so `</script` cannot appear in the output at all, and neither can
 *          `<!--`, which puts the HTML parser into a script-data escaped
 *          state where the rules change again
 *   U+2028
 *   U+2029 line separators, which some engines and tools still treat as
 *          literal line terminators
 *
 * Escaping `<` and `>` unconditionally rather than pattern-matching
 * `</script` on purpose: `</ScRiPt`, `</script\t` and `</script/` all close
 * the element too, and a rule that has to enumerate those is a rule with a
 * case missing.
 */
export function scriptStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Escaped for a double-quoted HTML attribute. Unchanged - it was already
 * correct, and is kept here so both escapes for this page live together. */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The page itself.
 *
 * fetch()-driven rather than an auto-submitted <form>, and the token is not
 * checked for validity here - see the header comment on the route for both.
 */
export function renderVerifyPage(token: string): string {
  const safeToken = escapeHtmlAttr(token);
  const jsToken = scriptStringLiteral(token);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signing in…</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f1e2; color: #2b241c;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; }
    .brand { font-size: 20px; font-weight: 700; color: #2c6a4c; margin-bottom: 12px; }
    button { font-family: inherit; background: #2c6a4c; color: white; border: none; border-radius: 8px;
             padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 12px; }
    #fallback { display: none; }
  </style>
</head>
<body>
  <div class="box">
    <div class="brand">decide</div>
    <p>Finishing sign-in…</p>
    <form id="f" method="POST" action="/api/auth/verify">
      <input type="hidden" name="token" value="${safeToken}" />
      <noscript><button type="submit">Click to finish signing in</button></noscript>
      <button id="fallback" type="submit">Click to finish signing in</button>
    </form>
  </div>
  <script>
    (function () {
      var fallbackTimer = setTimeout(function () {
        document.getElementById('fallback').style.display = 'inline-block';
      }, 4000);

      var body = new URLSearchParams();
      body.set('token', ${jsToken});

      fetch('/api/auth/verify', { method: 'POST', body: body })
        .then(function (res) {
          clearTimeout(fallbackTimer);
          // fetch() only rejects on network-level failure - an HTTP error
          // status (e.g. a 500 from an unhandled exception on the server)
          // still resolves here with res.ok === false. Blindly navigating
          // to res.url in that case is exactly how a real server error
          // turned into a confusing "?error=missing_token": with no
          // redirect to follow, res.url is just this same POST endpoint
          // with no query string, and *that* URL's own GET handler is what
          // was actually producing the missing_token redirect - hiding the
          // real failure completely. Checking res.ok first means a genuine
          // server error now falls through to the visible fallback button
          // instead of masquerading as a token problem.
          if (res.ok) {
            // redirect: 'follow' is fetch's default - res.url is already the
            // final /account?... URL after following the server's 303, and
            // any Set-Cookie along that chain has already been applied by
            // the browser by the time this callback runs.
            window.location.href = res.url;
          } else {
            document.getElementById('fallback').style.display = 'inline-block';
          }
        })
        .catch(function () {
          clearTimeout(fallbackTimer);
          document.getElementById('fallback').style.display = 'inline-block';
        });
    })();
  </script>
</body>
</html>`;
}
