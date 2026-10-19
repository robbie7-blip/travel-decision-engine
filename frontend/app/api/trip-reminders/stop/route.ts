// The "Stop these emails" link in every evening-before email. No sign-in -
// the link is signed for this one trip (lib/dayAhead.ts), so it cannot be
// used to stop anyone else's.
//
// GET only shows a button; the POST it sends is what stops the emails.
// Mail scanners open every link in an email before the reader does, and a
// GET that stopped them would switch the reminders off after the first
// email, with nobody having asked.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, type Job } from "@/lib/jobs";
import { dayAheadKey, verifyStopToken } from "@/lib/dayAhead";
import { escapeHtml } from "@/lib/itineraryEmail";
import { TRANSLATIONS } from "@/lib/i18n";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalid(): NextResponse {
  return new NextResponse("This link is not valid.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function languageOf(jobId: string): Promise<"en" | "bg"> {
  try {
    const job = readJobRecord(await getRedis().get<string | Job>(jobKey(jobId)));
    return job?.brief.language === "bg" ? "bg" : "en";
  } catch {
    return "en";
  }
}

function page(language: "en" | "bg", body: string): NextResponse {
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>decide</title></head>
<body style="margin:0;padding:48px 16px;background:#faf8f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b241c">
<div style="max-width:480px;margin:0 auto">${body}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!jobId || jobId.length > 100 || !verifyStopToken(jobId, token)) return invalid();
  const language = await languageOf(jobId);
  const t = TRANSLATIONS[language].result.dayAhead;
  return page(
    language,
    `<form method="post" action="/api/trip-reminders/stop">
<input type="hidden" name="jobId" value="${escapeHtml(jobId)}"><input type="hidden" name="t" value="${escapeHtml(token)}">
<button type="submit" style="min-height:44px;padding:10px 22px;border:0;border-radius:8px;background:#2c6a4c;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer">${escapeHtml(t.stop)}</button>
</form>
<p><a href="/trip/${encodeURIComponent(jobId)}" style="color:#2c6a4c">${escapeHtml(t.open)}</a></p>`
  );
}

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalid();
  }
  const jobId = String(form.get("jobId") ?? "").trim();
  const token = String(form.get("t") ?? "");
  if (!jobId || jobId.length > 100 || !verifyStopToken(jobId, token)) return invalid();
  await getRedis().del(dayAheadKey(jobId));
  const language = await languageOf(jobId);
  const t = TRANSLATIONS[language].result.dayAhead;
  return page(
    language,
    `<p style="font-size:17px">${escapeHtml(t.stopped)}</p>
<p><a href="/trip/${encodeURIComponent(jobId)}" style="color:#2c6a4c">${escapeHtml(t.open)}</a></p>`
  );
}
