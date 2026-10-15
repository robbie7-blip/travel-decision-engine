// Called once a day by Vercel Cron (frontend/vercel.json) to email the
// owner yesterday's trips. Vercel sends `Authorization: Bearer
// $CRON_SECRET`; anything else is refused, and so is every request while
// CRON_SECRET is unset - an open URL that sends email on demand is not a
// thing to leave lying around.

import { NextRequest, NextResponse } from "next/server";
import { runDailyReport } from "@/lib/dailyReportRun";
import { isCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ detail: "Not allowed." }, { status: 401 });
  }
  const run = await runDailyReport({ send: true });
  if (!run.ok) {
    console.error("[daily-report]", run.detail);
    return NextResponse.json({ detail: run.detail }, { status: 500 });
  }
  return NextResponse.json({ sent: run.sent, subject: run.report.subject });
}
