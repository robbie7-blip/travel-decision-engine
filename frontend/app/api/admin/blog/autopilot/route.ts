// "Write a post now" on /admin/blog: runs the blog autopilot once, on
// demand, exactly as the Monday and Thursday run does (lib/blogAutopilot
// Run.ts). Behind the admin password (middleware.ts covers /api/admin/*).

import { NextRequest, NextResponse } from "next/server";
import { runAutopilotAndNotify } from "@/lib/blogAutopilotRun";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const result = await runAutopilotAndNotify({ scheduled: false });
  if (!result.ok) return NextResponse.json({ detail: result.detail }, { status: 502 });
  return NextResponse.json({ id: result.post.id, slug: result.post.slug, title: result.post.title, status: result.status, issues: result.issues });
}
