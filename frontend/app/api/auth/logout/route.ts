import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";
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
  response.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return response;
}
