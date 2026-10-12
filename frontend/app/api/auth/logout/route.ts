import { NextRequest, NextResponse } from "next/server";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { getSiteUrl } from "@/lib/siteUrl";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // The mildest of the three auth routes to protect and still worth it: a
  // cross-origin POST here signs somebody out of a session they are using,
  // which is a nuisance rather than a compromise, and the check is the same
  // line. See lib/sameOrigin.ts.
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  // Cleared with the same attributes it was set with, maxAge aside. A
  // browser matches a cookie to overwrite by name, domain and path, so the
  // path is the load-bearing part - but now that the cookie is also
  // RE-ISSUED on use (see lib/session.ts), the three places that write it
  // agreeing is worth more than it was: a mismatch leaves a second cookie
  // of the same name behind, and signing out would clear one of them.
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
