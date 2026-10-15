// Publishing a trip as a public page (/plans/<slug>), and taking it down.
//
// GET  ?jobId=          whether this visitor can publish it (signed in, and
//                       the trip is theirs), and its page if it has one.
// POST {jobId, publish} true publishes (or refreshes) it, false removes it.
//
// What is published is the PLAN and the public facts around it - the
// cities, the day count, who it was for in the traveller's own words -
// copied, so the page outlives the trip. Never the account, the budget,
// the diet, mobility or anything else from the private brief.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";
import { getDb } from "@/lib/db";
import { publicBrief } from "@/lib/publicBrief";
import { publishedForJob, publishedSlug, publishedTitle, publishTrip, unpublishTrip } from "@/lib/tripsQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function owned(request: NextRequest, jobId: string): Promise<{ job: Job; email: string } | null> {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email || !jobId || jobId.length > 100) return null;
  const job = readJobRecord(await getRedis().get<string | Job>(jobKey(jobId)));
  if (!job || job.status !== "done" || !job.result) return null;
  if (job.ownerEmail?.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return { job, email };
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  const db = getDb();
  try {
    const mine = db ? await owned(request, jobId) : null;
    if (!mine || !db) return NextResponse.json({ available: false, slug: null }, { headers: NO_STORE });
    return NextResponse.json({ available: true, slug: await publishedForJob(db, jobId) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false, slug: null }, { headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  let body: { jobId?: unknown; publish?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (typeof body.publish !== "boolean") return NextResponse.json({ detail: "publish must be true or false." }, { status: 400 });
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "Publishing is not available on this deployment." }, { status: 503 });
  const mine = await owned(request, jobId).catch(() => null);
  if (!mine) return NextResponse.json({ detail: "Only the account that planned this trip can publish it." }, { status: 403 });

  try {
    if (!body.publish) {
      await unpublishTrip(db, jobId, mine.email);
      return NextResponse.json({ available: true, slug: null }, { headers: NO_STORE });
    }
    const brief = publicBrief(mine.job.brief);
    const itinerary = mine.job.result!;
    const dayCount = itinerary.days?.length ?? 0;
    const language = brief.language === "bg" ? "bg" : "en";
    const slug = await publishTrip(db, {
      slug: publishedSlug(brief.destinations, dayCount, jobId),
      jobId,
      ownerEmail: mine.email,
      language,
      title: publishedTitle(brief.destinations, dayCount, language),
      summary: typeof itinerary.trip_summary === "string" ? itinerary.trip_summary.slice(0, 600) : "",
      destinations: brief.destinations,
      dayCount,
      party: brief.party_composition || null,
      // The plan as the page shows it; the last pushback's answer is a
      // reply to this traveller, not part of a guide.
      itinerary: { ...itinerary, pushback_response: undefined },
    });
    return NextResponse.json({ available: true, slug }, { headers: NO_STORE });
  } catch (e) {
    console.warn("[trip-publish]", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ detail: "Could not publish right now. Try again in a minute." }, { status: 500 });
  }
}
