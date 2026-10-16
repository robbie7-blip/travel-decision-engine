// The buttons in the "How was your trip?" email (lib/howWasIt.ts).
//
// GET shows a small page: thanks for the answer tapped, and a box for an
// optional note. The answer itself is saved by a POST the page makes as it
// loads, not by the GET: mail scanners open every link in an email before
// the reader does, and a GET that recorded the rating would have all three
// buttons "tapped", the last one winning. Without JavaScript the Send
// button posts the rating and the note together.
//
// Every request carries the per-trip signature from the email, so a link
// cannot be edited to answer for someone else's trip.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, type Job } from "@/lib/jobs";
import { isRating, verifyFeedbackToken } from "@/lib/howWasIt";
import { escapeHtml } from "@/lib/itineraryEmail";
import { TRANSLATIONS } from "@/lib/i18n";
import { getDb } from "@/lib/db";
import { saveTripNote, saveTripRating, type TripRating } from "@/lib/tripsQuery";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

async function tripFacts(jobId: string): Promise<{ destinations: string[]; language: "en" | "bg" }> {
  try {
    const job = readJobRecord(await getRedis().get<string | Job>(jobKey(jobId)));
    if (job) {
      return {
        destinations: (job.brief.destinations ?? []).filter((d): d is string => typeof d === "string").slice(0, 10),
        language: job.brief.language === "bg" ? "bg" : "en",
      };
    }
  } catch {
    // The page still works without the trip; only the admin view loses
    // the city names.
  }
  return { destinations: [], language: "en" };
}

function page(language: "en" | "bg", body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>decide</title></head>
<body style="margin:0;padding:48px 16px;background:#faf8f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b241c">
<div style="max-width:480px;margin:0 auto">${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: HEADERS });
}

function invalid(language: "en" | "bg" = "en"): NextResponse {
  return page(language, `<p style="font-size:17px">${escapeHtml(TRANSLATIONS[language].howWasIt.invalid)}</p>`, 400);
}

const THANKS: Record<TripRating, "thanksGreat" | "thanksOk" | "thanksBad"> = { great: "thanksGreat", ok: "thanksOk", bad: "thanksBad" };

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  const rating = request.nextUrl.searchParams.get("r");
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!jobId || jobId.length > 100 || !isRating(rating) || !verifyFeedbackToken(jobId, token)) return invalid();

  const { language } = await tripFacts(jobId);
  const t = TRANSLATIONS[language].howWasIt;
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  // The values go into the script as JSON with "<" escaped, so nothing in
  // them can close the script element.
  const payload = JSON.stringify({ jobId, r: rating, t: token }).replace(/</g, "\\u003c");
  return page(
    language,
    `<p style="font-size:19px;font-weight:600;margin:0 0 18px">${escapeHtml(t[THANKS[rating]])}</p>
<form method="post" action="/api/trip-feedback">
${hidden("jobId", jobId)}${hidden("r", rating)}${hidden("t", token)}
<label for="note" style="display:block;font-size:15px;line-height:1.5;margin-bottom:8px">${escapeHtml(t.notePrompt)}</label>
<textarea id="note" name="note" rows="5" maxlength="2000" style="box-sizing:border-box;width:100%;font:inherit;font-size:16px;padding:10px;border:1px solid #c9bfae;border-radius:8px;background:#fff;color:inherit"></textarea>
<button type="submit" style="margin-top:12px;min-height:44px;padding:10px 22px;border:0;border-radius:8px;background:#2c6a4c;color:#fff;font:inherit;font-weight:700;cursor:pointer">${escapeHtml(t.send)}</button>
</form>
<script>(function(){var p=${payload};var b=new URLSearchParams(p);fetch("/api/trip-feedback",{method:"POST",body:b,headers:{"Accept":"application/json"}}).catch(function(){});})();</script>`
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
  const rating = String(form.get("r") ?? "");
  const token = String(form.get("t") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!jobId || jobId.length > 100 || !isRating(rating) || !verifyFeedbackToken(jobId, token)) return invalid();

  const facts = await tripFacts(jobId);
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const db = getDb();
  let saved = false;
  if (db) {
    try {
      await saveTripRating(db, { jobId, rating, destinations: facts.destinations, language: facts.language });
      if (note) await saveTripNote(db, jobId, note);
      saved = true;
    } catch (e) {
      console.warn("[trip-feedback] could not save:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  if (wantsJson) return NextResponse.json({ saved }, { status: saved ? 200 : 503 });
  const t = TRANSLATIONS[facts.language];
  return page(
    facts.language,
    `<p style="font-size:19px;font-weight:600;margin:0 0 18px">${escapeHtml(saved ? t.howWasIt.sent : t.howWasIt.notSaved)}</p>
<p><a href="/trip/${encodeURIComponent(jobId)}" style="color:#2c6a4c">${escapeHtml(t.result.dayAhead.open)}</a></p>`,
    saved ? 200 : 503
  );
}
