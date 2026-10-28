// Friends and family testing the site (app/admin/testers): each email
// listed gets the yearly plan's allowance without paying. Protected by
// middleware.ts like every /api/admin route.

import { NextRequest, NextResponse } from "next/server";
import { listTesters, setTester } from "@/lib/account";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  try {
    return NextResponse.json({ testers: await listTesters(getRedis()) });
  } catch {
    return NextResponse.json({ detail: "Redis is not configured." }, { status: 500 });
  }
}

/** { email, on }: on true adds them, false takes them off. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; on?: unknown } | null;
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
