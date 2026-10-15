// The "Stop these emails" link in every evening-before email. One click,
// no sign-in - the link is signed for this one trip (lib/dayAhead.ts), so
// it cannot be used to stop anyone else's.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, type Job } from "@/lib/jobs";
import { dayAheadKey, verifyStopToken } from "@/lib/dayAhead";
import { escapeHtml } from "@/lib/itineraryEmail";
import { TRANSLATIONS } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  const token = request.nextUrl.searchParams.get("t");
  if (!jobId || jobId.length > 100 || !verifyStopToken(jobId, token)) {
    return new NextResponse("This link is not valid.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const redis = getRedis();
  await redis.del(dayAheadKey(jobId));
  const job = readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
  const t = TRANSLATIONS[job?.brief.language === "bg" ? "bg" : "en"];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>decide</title></head>
<body style="margin:0;padding:48px 16px;background:#faf8f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b241c">
<div style="max-width:480px;margin:0 auto"><p style="font-size:17px">${escapeHtml(t.result.dayAhead.stopped)}</p>
<p><a href="/trip/${encodeURIComponent(jobId)}" style="color:#2c6a4c">${escapeHtml(t.result.dayAhead.open)}</a></p></div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
