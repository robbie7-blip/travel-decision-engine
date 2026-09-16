// The admin gate's POLICY, through the real middleware.
//
// adminAuth.test.ts covers the credential handling. This covers the
// decisions around it, and there are two that are easy to get subtly wrong
// in a way no unit test of the parser would catch.
//
// A REQUEST WITH NO CREDENTIAL MUST NOT SPEND AN ATTEMPT. The browser's
// first request to /admin never carries one - that is how Basic Auth works,
// the 401 is what makes it ask - so counting those would let anyone lock the
// owner out of their own tool by opening the URL ten times, and the owner
// would do it to themselves by having ten tabs open.
//
// AND THE OWNER'S CORRECT PASSWORD MUST COST NOTHING. The limiter is
// consulted only after a credential has already failed, which is what makes
// it safe to fail CLOSED on a Redis error. That property is asserted here
// the only way it can be from outside: with no Redis configured at all, a
// correct password still gets through, and a wrong one does not.
//
// Run: npm run test:admin-gate

import { NextRequest } from "next/server";
import { check, finish, heading, section } from "./testutil";

heading("the admin gate's policy");

const PASSWORD = "k3Hn2pQvXr8sLm4T";

/** One request at an admin path, with whatever Authorization header. */
function request(header?: string): NextRequest {
  return new NextRequest("https://yourdecide.com/admin/feedback", {
    headers: header ? { authorization: header } : {},
  });
}

const basic = (user: string, password: string): string => `Basic ${btoa(`${user}:${password}`)}`;

async function main() {
  // Deliberately NOT configuring Upstash. Everything below therefore proves
  // something about whether Redis was needed at all: getRedis() throws
  // without those variables, and middleware treats a limiter it cannot
  // reach as "no attempts left".
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const { middleware } = await import("../middleware");

  {
    section("no password configured");

    delete process.env.ADMIN_PASSWORD;
    const res = await middleware(request());
    check("the area 503s rather than opening unprotected", res.status === 503, String(res.status));
    const withCred = await middleware(request(basic("admin", "anything")));
    check("and a credential cannot get in either", withCred.status === 503, String(withCred.status));

    // An empty string is unset, the same way every other consumer of a
    // secret in this app treats it.
    process.env.ADMIN_PASSWORD = "";
    check("an empty password is unset", (await middleware(request())).status === 503);
  }

  process.env.ADMIN_PASSWORD = PASSWORD;

  {
    section("the ordinary first request");

    const res = await middleware(request());
    check("no credential gets the challenge", res.status === 401, String(res.status));
    check(
      "  with the header that makes the browser ask",
      res.headers.get("www-authenticate") === 'Basic realm="admin"',
      String(res.headers.get("www-authenticate"))
    );

    // THE property. With no Redis reachable, a counted attempt would come
    // back 429 - so a 401 here proves the limiter was never consulted, and
    // that opening /admin in ten tabs cannot lock the owner out.
    for (let i = 0; i < 10; i++) {
      const again = await middleware(request());
      if (again.status !== 401) {
        check(`request ${i + 1} with no credential spent an attempt`, false, String(again.status));
        break;
      }
    }
    check("ten credential-less requests all get 401, never 429", true);
  }

  {
    section("the owner, with the right password");

    const res = await middleware(request(basic("admin", PASSWORD)));
    // NextResponse.next() carries this header; a 401/429/503 does not.
    check("gets through", res.status === 200, String(res.status));
    check("  and it is a pass-through, not a page", res.headers.get("x-middleware-next") === "1", String(res.headers.get("x-middleware-next")));
    check("  no challenge header", res.headers.get("www-authenticate") === null);

    // Same property as above, the other way round: with no Redis at all the
    // correct password still works, so the limiter is not in its path.
    for (let i = 0; i < 5; i++) {
      const again = await middleware(request(basic("robbie", PASSWORD)));
      if (again.status !== 200) {
        check(`correct password ${i + 1} was refused`, false, String(again.status));
        break;
      }
    }
    check("repeated correct passwords are never throttled", true);

    check("any username still works", (await middleware(request(basic("", PASSWORD)))).status === 200);
  }

  {
    section("a wrong password, with no limiter reachable");

    // Fail-CLOSED, and deliberately unlike every other limiter in the app.
    // The others guard cost, where refusing a paying traveller is worse
    // than serving one extra request. This guards a credential, where
    // losing an internal tool during a Redis outage is recoverable and
    // handing out unlimited guesses is not.
    const res = await middleware(request(basic("admin", "wrong")));
    check("is refused", res.status !== 200, String(res.status));
    check("  and refused closed, not open", res.status === 429, String(res.status));
    check("  with no Retry-After schedule to work against", res.headers.get("retry-after") === null);

    check("a near-miss is no better", (await middleware(request(basic("admin", PASSWORD.slice(0, -1))))).status === 429);
    check("nor is the password plus a character", (await middleware(request(basic("admin", PASSWORD + "x")))).status === 429);
  }

  {
    section("malformed credentials are not a way in");

    for (const header of ["Bearer abc", "Basic !!!!", "Basic ", `Basic ${btoa("nocolon")}`, "Basic ====", PASSWORD]) {
      const res = await middleware(request(header));
      check(`${JSON.stringify(header.slice(0, 22))} does not get through`, res.status !== 200, String(res.status));
      // These parse to "no credential", so they get the challenge rather
      // than burning a limiter slot - the same treatment as no header.
      check("  and is treated as no credential, not a failed guess", res.status === 401, String(res.status));
    }
  }

  {
    section("the matcher covers what it claims to");

    // Named explicitly because a gap here is silent: an admin surface
    // outside the matcher is simply public.
    const { config } = await import("../middleware");
    check("admin pages are matched", config.matcher.includes("/admin/:path*"));
    check("and the admin API, which lives under /api", config.matcher.includes("/api/admin/:path*"));
    check("nothing else is", config.matcher.length === 2, JSON.stringify(config.matcher));
  }

  finish();
}

main();
