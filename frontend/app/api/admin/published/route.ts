// Taking down any published trip page, from /admin/trips. Behind the admin
// password (middleware.ts covers /api/admin/*).

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnpublish } from "@/lib/tripsQuery";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const db = getDb();
  if (!slug || !db) return NextResponse.json({ detail: "slug is required." }, { status: 400 });
  await adminUnpublish(db, slug);
  return NextResponse.json({ removed: slug });
}
