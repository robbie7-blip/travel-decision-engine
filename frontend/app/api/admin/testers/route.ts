// Friends and family testing the site (app/admin/testers): the tester
// link (lib/testerPass.ts), and the emails that get the paid plan when
// signed in. Protected by middleware.ts like every /api/admin route.

import { NextRequest, NextResponse } from "next/server";
import { listTesters, setTester } from "@/lib/account";
import { getRedis } from "@/lib/redis";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";
import { currentTesterCode, newTesterCode, turnOffTesterLink } from "@/lib/testerPass";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The link on the address the admin page itself is open on, so it is
 * the site friends should land on whatever SITE_URL says. */
function linkFor(request: NextRequest, code: string | null): string | null {
  return code ? new URL(`/tester/${code}`, request.nextUrl.origin).toString() : null;
}

export async function GET(request: NextRequest) {
  try {
    const redis = getRedis();
    return NextResponse.json({ testers: await listTesters(redis), link: linkFor(request, await currentTesterCode(redis)) });
  } catch {
    return NextResponse.json({ detail: "Redis is not configured." }, { status: 500 });
  }
}

/** { link: "new" | "off" } makes a new tester link or turns it off; or
 * { email, on }: on true adds them, false takes them off. */
export async function POST(request: NextRequest) {
  // The browser sends the admin password with any request to this site,
  // even one another page started; only the site itself may change who
  // gets the paid plan for free.
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { email?: unknown; on?: unknown; link?: unknown } | null;
  if (body?.link === "new" || body?.link === "off") {
    try {
      const redis = getRedis();
      if (body.link === "off") {
        await turnOffTesterLink(redis);
        return NextResponse.json({ link: null });
      }
      return NextResponse.json({ link: linkFor(request, await newTesterCode(redis)) });
    } catch {
      return NextResponse.json({ detail: "Could not save. Try again." }, { status: 500 });
    }
  }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ detail: "That is not an email address." }, { status: 400 });
  }
  try {
    const redis = getRedis();
    await setTester(redis, email, body?.on !== false);
    return NextResponse.json({ testers: await listTesters(redis) });
  } catch {
    return NextResponse.json({ detail: "Could not save. Try again." }, { status: 500 });
  }
}
