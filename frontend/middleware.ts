// Protects /admin/* with HTTP Basic Auth. Deliberately minimal - this is a
// single-owner internal tool (browsing feedback entries), not a multi-user
// auth system, so a shared password checked at the edge is proportional.
//
// "Proportional" was doing too much work, though. Minimal is the right shape
// for the UI; it was not a reason for the gate itself to be the only
// credential surface in the app with NOTHING limiting the guessing. Every
// other one is rate limited - sign-in links, generation, feedback, trip
// questions, flight import, the anonymous share write - and this one
// returned 401 with no record that an attempt had happened, so it could be
// tried as fast as the network allows, forever, with nothing logged. What is
// behind it is travellers' own feedback text (/admin/feedback) and the same
// value is the test-mode key /api/generate accepts to skip the daily spend
// cap and every rate limit, so a guessed password also spends the owner's
// Anthropic money without bound.
//
// The credential handling is in lib/adminAuth.ts, where it can be tested;
// this file is the policy. Runs on the Edge runtime, which has no Buffer and
// no node:crypto - hence atob and WebCrypto in there rather than here.

import { NextResponse, type NextRequest } from "next/server";
import { basicAuthPassword, secretsMatch } from "@/lib/adminAuth";
import { getClientIp } from "@/lib/clientIp";
import { ADMIN_AUTH_PREFIX, ADMIN_AUTH_WINDOWS, checkEdgeLimit } from "@/lib/edgeRateLimit";

/** 401 with the Basic challenge - what an unauthenticated request gets, and
 * deliberately identical whether no credential was sent or a wrong one was.
 * The only thing that distinguishes them is the limiter bucket. */
function challenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}

/** Records one failed attempt and says whether this client has any left.
 *
 * Consulted ONLY after a credential has already failed, which is what keeps
 * the owner's own correct password free of any round-trip and immune to
 * this. Fail-CLOSED, unlike every other limiter in the app - see
 * checkEdgeLimit, which is also why this cannot use lib/ratelimit.ts: that
 * module reaches @upstash/redis's Node build, and this file runs on the
 * Edge. */
async function failedAttemptAllowed(request: NextRequest): Promise<boolean> {
  const result = await checkEdgeLimit(ADMIN_AUTH_PREFIX, getClientIp(request), ADMIN_AUTH_WINDOWS);
  if (!result.allowed) {
    // Worth a line, because "nothing logged" was half the original problem:
    // a run of failed admin logins is the one event here anybody would want
    // to know about after the fact. The reason distinguishes a real limit
    // from an unreachable counter, which look identical from outside.
    console.warn(`[admin] failed sign-in refused (${result.exceeded})`);
  }
  return result.allowed;
}

export async function middleware(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse("Admin view is not configured (ADMIN_PASSWORD is not set).", {
      status: 503,
    });
  }

  const submitted = basicAuthPassword(request.headers.get("authorization"));

  // No credential at all is the ordinary first request - the browser has to
  // be told to ask. It is not a failed guess and does not spend an attempt,
  // or simply opening /admin in a new session would.
  if (submitted === null) return challenge();

  if (await secretsMatch(submitted, expected)) return NextResponse.next();

  if (!(await failedAttemptAllowed(request))) {
    // 429 rather than another 401, deliberately. It tells a guesser they are
    // throttled, which they would work out from the timing anyway, and it
    // tells the OWNER - who will see this if they fat-finger the prompt a
    // few times - what is actually happening instead of an endless password
    // box. No Retry-After: the number of failures is not something to
    // publish a schedule for.
    return new NextResponse("Too many failed sign-in attempts. Try again later.", { status: 429 });
  }

  return challenge();
}

export const config = {
  // /api/admin/:path* covers the demo-trip admin API (see
  // app/api/admin/demo-trip/route.ts) - it lives under /api, not /admin,
  // since Next.js route handlers alongside a page path is unconventional,
  // so it needs its own matcher entry rather than falling under /admin/:path*.
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
