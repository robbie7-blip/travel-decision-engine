// Called once a day by Vercel Cron (frontend/vercel.json) to email the
// owner yesterday's trips. Vercel sends `Authorization: Bearer
// $CRON_SECRET`; anything else is refused, and so is every request while
// CRON_SECRET is unset - an open URL that sends email on demand is not a
// thing to leave lying around.

import { after, NextRequest, NextResponse } from "next/server";
import { runDailyReport } from "@/lib/dailyReportRun";
import { isCronRequest } from "@/lib/cronAuth";
import { isAutopilotDay } from "@/lib/blogAutopilot";
import { runAutopilotAndNotify } from "@/lib/blogAutopilotRun";
import { proofreadPublishedPosts } from "@/lib/blogProofread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The report takes seconds; on Mondays and Thursdays the blog autopilot
// runs after it (lib/blogAutopilotRun.ts) and needs most of a minute for
// the model to write the post. Riding on this cron rather than adding one
// keeps the project inside the plan's cron limit.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ detail: "Not allowed." }, { status: 401 });
  }
  // After the response, so the report is never held up by the post and a
  // failed post never fails the report.
  if (isAutopilotDay(new Date())) {
    after(async () => {
      const result = await runAutopilotAndNotify({ scheduled: true });
      console.log("[blog-autopilot]", result.ok ? `published ${result.post.slug}` : result.detail);
    });
  }
  // Any published post the copy check has not seen yet (lib/blogProofread.ts).
  after(async () => {
    const proofread = await proofreadPublishedPosts();
    if (proofread.corrected.length > 0) console.log("[blog-proofread] corrected:", proofread.corrected.join("; "));
  });
  const run = await runDailyReport({ send: true });
  if (!run.ok) {
    console.error("[daily-report]", run.detail);
    return NextResponse.json({ detail: run.detail }, { status: 500 });
  }
  return NextResponse.json({ sent: run.sent, subject: run.report.subject });
}
