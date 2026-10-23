// The blog's first posts (lib/blogStarter.ts), added and published with
// one button on /admin/blog. Behind the admin password (middleware.ts
// covers /api/admin/*). Posts already there are left alone.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { addStarterPosts } from "@/lib/blogStarter";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database on this deployment (DATABASE_URL is not set)." }, { status: 503 });
  try {
    return NextResponse.json(await addStarterPosts(db), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.warn("[admin/blog] starter:", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ detail: "Could not add the posts." }, { status: 500 });
  }
}
