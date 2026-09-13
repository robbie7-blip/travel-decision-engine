// Login CSRF on the sign-in endpoint, and the header check that closes it.
//
// POST /api/auth/verify consumes a magic-link token and sets the session
// cookie, and it accepted that POST from any origin. An attacker requests a
// link for THEIR OWN account, puts the token in a form on a page they
// control, and gets a victim's browser to submit it - the victim is then
// silently signed in as the attacker, and every brief they type afterwards
// lands in an account the attacker can read.
//
// The tests below are mostly about the ways a check like this is wrong
// rather than absent: an Origin compared as a string (so
// https://yourdecide.com.evil.test passes a startsWith), an opaque "null"
// origin treated as "no information" when it is something an attacker
// creates on purpose, and a same-origin fallback form refused because
// somebody assumed form POSTs carry no Origin.
//
// Run: npm run test:same-origin

import { allowedOriginsFor, classifyRequestOrigin, isCrossOriginRequest } from "./sameOrigin";
import { check, finish, heading, section } from "./testutil";

heading("same-origin checks on state-changing requests");

const SITE = "https://yourdecide.com";
const ALLOWED = [SITE];

/** Headers as a route sees them - the same `get` interface NextRequest
 * exposes, lower-cased lookups included. */
function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function main() {
  {
    section("what the browser tells us, when it tells us");

    check(
      "a fetch from our own page is same-origin",
      classifyRequestOrigin(headers({ "sec-fetch-site": "same-origin" }), ALLOWED) === "same-origin"
    );
    check(
      "a different subdomain of ours counts as ours",
      classifyRequestOrigin(headers({ "sec-fetch-site": "same-site" }), ALLOWED) === "same-origin"
    );
    check(
      "the attack is refused",
      classifyRequestOrigin(headers({ "sec-fetch-site": "cross-site" }), ALLOWED) === "cross-origin"
    );
    check(
      "and so is a cross-origin same-site-less request",
      classifyRequestOrigin(headers({ "sec-fetch-site": "cross-origin" }), ALLOWED) === "cross-origin"
    );

    // "none" means no initiating origin - a typed URL, a bookmark, a
    // restored session. Allowed because an attacker's page cannot produce
    // it: the value comes from the initiator, and a page that initiates a
    // request IS an initiator.
    check(
      "a request with no initiator is allowed",
      classifyRequestOrigin(headers({ "sec-fetch-site": "none" }), ALLOWED) === "same-origin"
    );

    // Sec-Fetch-Site wins when both are present: it is the browser's own
    // answer and needs no parsing to be right.
    check(
      "sec-fetch-site beats a contradicting origin",
      classifyRequestOrigin(
        headers({ "sec-fetch-site": "cross-site", origin: SITE }),
        ALLOWED
      ) === "cross-origin"
    );
  }

  {
    section("falling back to Origin, for browsers without Sec-Fetch-Site");

    // Origin is present on every non-GET request per the Fetch spec,
    // same-origin ones included - which is what makes the <noscript>
    // fallback form work. Assuming otherwise is how this check gets
    // written so loosely it does nothing.
    check(
      "our own origin passes",
      classifyRequestOrigin(headers({ origin: SITE }), ALLOWED) === "same-origin"
    );
    check(
      "an attacker's origin is refused",
      classifyRequestOrigin(headers({ origin: "https://evil.test" }), ALLOWED) === "cross-origin"
    );

    // THE string-comparison traps. Each of these passes a startsWith or an
    // includes, and none of them is our origin.
    for (const hostile of [
      "https://yourdecide.com.evil.test",
      "https://yourdecide.com@evil.test",
      "https://evil.test/?x=https://yourdecide.com",
      "https://notyourdecide.com",
      "http://yourdecide.com",
      "https://yourdecide.com:8443",
    ]) {
      check(
        `refused: ${hostile}`,
        classifyRequestOrigin(headers({ origin: hostile }), ALLOWED) === "cross-origin"
      );
    }

    // ...while the equivalences a string comparison gets WRONG in the other
    // direction still pass.
    check(
      "the default port spelled out is still the same origin",
      classifyRequestOrigin(headers({ origin: "https://yourdecide.com:443" }), ALLOWED) === "same-origin"
    );
    check(
      "a trailing path on the configured URL does not break the match",
      classifyRequestOrigin(headers({ origin: SITE }), ["https://yourdecide.com/"]) === "same-origin"
    );

    // An opaque origin - a sandboxed iframe, a data: URL document. This is
    // the one that must NOT be read as "no information": a sandboxed iframe
    // is something an attacker creates deliberately.
    check(
      'a literal "null" origin is cross-origin, not unknown',
      classifyRequestOrigin(headers({ origin: "null" }), ALLOWED) === "cross-origin"
    );

    check(
      "an unparseable origin is refused rather than accepted",
      classifyRequestOrigin(headers({ origin: "not a url" }), ALLOWED) === "cross-origin"
    );
  }

  {
    section("no signal at all");

    // Allowed, deliberately. Neither header can be stripped by page script -
    // both are forbidden header names - so a request with neither is not
    // something an attack can manufacture, while refusing it would break
    // sign-in on any client that sends neither. The attack always arrives
    // WITH a signal, naming the attacker.
    check("no headers is no-signal", classifyRequestOrigin(headers({}), ALLOWED) === "no-signal");
    check("and is not refused", isCrossOriginRequest(headers({}), ALLOWED) === false);

    // An empty header value is absent, not present-and-empty.
    check(
      "an empty sec-fetch-site falls through to origin",
      classifyRequestOrigin(headers({ "sec-fetch-site": "", origin: SITE }), ALLOWED) === "same-origin"
    );
    check(
      "an empty origin is no-signal",
      classifyRequestOrigin(headers({ origin: "" }), ALLOWED) === "no-signal"
    );
  }

  {
    section("which origins count as ours");

    // A Vercel preview answers on its own *.vercel.app host while SITE_URL
    // still points at production. A check that only knew SITE_URL would
    // refuse sign-in on every preview deployment.
    const preview = allowedOriginsFor("https://decide-abc123.vercel.app/api/auth/verify", SITE);
    check("the request's own origin is allowed", preview.includes("https://decide-abc123.vercel.app"));
    check("  and the configured site too", preview.includes(SITE));
    check(
      "so a preview's own page passes",
      classifyRequestOrigin(headers({ origin: "https://decide-abc123.vercel.app" }), preview) === "same-origin"
    );
    check(
      "and an attacker still does not",
      classifyRequestOrigin(headers({ origin: "https://evil.test" }), preview) === "cross-origin"
    );

    // A broken SITE_URL must not take the request's own origin down with it.
    const broken = allowedOriginsFor("https://yourdecide.com/api/auth/verify", "not a url");
    check("a malformed site url is dropped, not fatal", broken.length === 1, JSON.stringify(broken));
    check(
      "  and the request's own origin still works",
      classifyRequestOrigin(headers({ origin: SITE }), broken) === "same-origin"
    );

    // Both malformed: no allowed origins at all. Every Origin is then
    // refused, which is the right way round - the failure is closed.
    const none = allowedOriginsFor("::::", "::::");
    check("no parseable origins leaves an empty list", none.length === 0);
    check(
      "  and an Origin-bearing request is then refused",
      classifyRequestOrigin(headers({ origin: SITE }), none) === "cross-origin"
    );
    check(
      "  while sec-fetch-site still answers on its own",
      classifyRequestOrigin(headers({ "sec-fetch-site": "same-origin" }), none) === "same-origin"
    );
  }

  {
    section("the attack, as the route sees it");

    // A form on an attacker's page, submitted by a victim's browser, with a
    // token the attacker owns. Both header shapes a real browser sends.
    const formPost = headers({
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      origin: "https://evil.test",
      "content-type": "application/x-www-form-urlencoded",
    });
    check("the login-CSRF POST is refused", isCrossOriginRequest(formPost, ALLOWED));

    const oldBrowserFormPost = headers({
      origin: "https://evil.test",
      "content-type": "application/x-www-form-urlencoded",
    });
    check("  including from a browser with no Sec-Fetch-Site", isCrossOriginRequest(oldBrowserFormPost, ALLOWED));

    const sandboxed = headers({ origin: "null", "content-type": "application/x-www-form-urlencoded" });
    check("  and from a sandboxed iframe", isCrossOriginRequest(sandboxed, ALLOWED));

    // The real sign-in, both paths the verify page offers.
    const realFetch = headers({
      "sec-fetch-site": "same-origin",
      origin: SITE,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    });
    check("the page's own fetch() is allowed", isCrossOriginRequest(realFetch, ALLOWED) === false);

    const realFallbackForm = headers({
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      origin: SITE,
      "content-type": "application/x-www-form-urlencoded",
    });
    check("  and so is the noscript fallback form", isCrossOriginRequest(realFallbackForm, ALLOWED) === false);
  }

  finish();
}

main();
