// Every evening (Vercel Cron, frontend/vercel.json): for each trip whose
// owner asked for it, email tomorrow's plan (lib/dayAhead.ts).
//
// Sends only to Job.ownerEmail - the address of the signed-in account that
// made the trip - and at most once per trip per day, whatever retries or
// double invocations happen (the sent key is claimed before sending).

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, type Job } from "@/lib/jobs";
import { isCronRequest } from "@/lib/cronAuth";
import { dayAheadEmailFor, dayAheadKey, dayAheadSentKey, stopToken, tomorrowIso } from "@/lib/dayAhead";
import { sendItineraryEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ detail: "Not allowed." }, { status: 401 });
  }
  const redis = getRedis();
  const site = getSiteUrl().replace(/\/$/, "");
  const date = tomorrowIso();

  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match: "dayahead:*", count: 200 });
    cursor = String(next);
    for (const key of batch) if (!key.startsWith("dayahead:sent:")) keys.push(key);
  } while (cursor !== "0" && keys.length < 5000);

  let sent = 0;
  let failed = 0;
  for (const key of keys) {
    const jobId = key.slice("dayahead:".length);
    try {
      const job = readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
      if (!job || job.status !== "done" || !job.result || !job.ownerEmail) {
        // The trip is gone or never was the owner's: nothing will ever be
        // sent for it, so the switch goes too.
        if (!job) await redis.del(dayAheadKey(jobId));
        continue;
      }
      const email = dayAheadEmailFor({
        itinerary: job.result,
        date,
        destinations: job.brief.destinations ?? [],
        language: job.brief.language === "bg" ? "bg" : "en",
        tripUrl: `${site}/trip/${encodeURIComponent(jobId)}`,
        stopUrl: `${site}/api/trip-reminders/stop?jobId=${encodeURIComponent(jobId)}&t=${encodeURIComponent(stopToken(jobId))}`,
        endDate: job.brief.end_date,
      });
      if (!email) continue;
      // Claimed before sending: a second run the same evening finds it.
      const claimed = await redis.set(dayAheadSentKey(jobId, date), "1", { nx: true, ex: 3 * 24 * 3600 });
      if (claimed !== "OK") continue;
      await sendItineraryEmail(job.ownerEmail, email.subject, email.html);
      sent++;
    } catch (e) {
      failed++;
      console.error(`[day-ahead] ${jobId}:`, e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ date, candidates: keys.length, sent, failed });
}
