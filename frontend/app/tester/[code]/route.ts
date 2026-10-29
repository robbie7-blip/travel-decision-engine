// The tester link (lib/testerPass.ts): a current code sets the pass cookie
// on this browser and shows the welcome page. Any other code goes to the
// homepage with nothing said, so the link cannot be probed for.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { isCurrentCode, passFor, TESTER_COOKIE_MAX_AGE_SECONDS, TESTER_COOKIE_NAME } from "@/lib/testerPass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let pass: string | null = null;
  try {
    if (code.length <= 64 && (await isCurrentCode(getRedis(), code))) pass = passFor(code);
  } catch {
    pass = null;
  }
  if (!pass) return NextResponse.redirect(new URL("/", request.url));
  const response = NextResponse.redirect(new URL("/tester/welcome", request.url));
  response.cookies.set(TESTER_COOKIE_NAME, pass, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TESTER_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
