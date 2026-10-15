// The daily report on demand, for the owner (behind the admin password:
// middleware.ts covers /api/admin/*). GET shows it; POST sends it now, to
// ADMIN_REPORT_EMAIL - the same and only recipient the daily run uses.

import { NextRequest, NextResponse } from "next/server";
import { runDailyReport } from "@/lib/dailyReportRun";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const run = await runDailyReport({ send: false });
  if (!run.ok) return new NextResponse(run.detail, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new NextResponse(run.report.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const run = await runDailyReport({ send: true });
  if (!run.ok) return NextResponse.json({ detail: run.detail }, { status: 500 });
  return NextResponse.json({ sent: run.sent, subject: run.report.subject });
}
