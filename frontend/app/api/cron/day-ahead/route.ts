// Every evening (Vercel Cron, frontend/vercel.json): for each trip whose
// owner asked for it, email tomorrow's plan (lib/dayAhead.ts).
//
// Sends only to Job.ownerEmail - the address of the signed-in account that
// made the trip - and at most once per trip per day, whatever retries or
// double invocations happen (the sent key is claimed before sending).
//
// The same run also sends "How was your trip?" (lib/howWasIt.ts) for
// signed-in trips that ended yesterday, once per trip, to the same owner.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, type Job } from "@/lib/jobs";
import { isCronRequest } from "@/lib/cronAuth";
import { dayAheadEmailFor, dayAheadKey, dayAheadSentKey, stopToken, tomorrowIso } from "@/lib/dayAhead";
import { sendItineraryEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";
import { getDb } from "@/lib/db";
import { tripsEndedOn } from "@/lib/tripsQuery";
import { howWasItEmailFor, howWasItSentKey, yesterdayIso } from "@/lib/howWasIt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ detail: "Not allowed." }, { status: 401 });
  }
  const startedAt = Date.now();
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
      try {
        await sendItineraryEmail(job.ownerEmail, email.subject, email.html);
      } catch (e) {
        // Not sent, so not claimed: a retry this evening tries again.
        await redis.del(dayAheadSentKey(jobId, date)).catch(() => {});
        throw e;
      }
      sent++;
    } catch (e) {
      failed++;
      console.error(`[day-ahead] ${jobId}:`, e instanceof Error ? e.message : e);
    }
  }

  const howWasIt = await sendHowWasIt(redis, site, startedAt);
  return NextResponse.json({ date, candidates: keys.length, sent, failed, howWasIt });
}

/** Stops starting new sends this long into the run. The function is
 * killed at maxDuration (60s), and one killed between claiming a trip and
 * sending its email would leave that trip claimed and never asked. */
const SEND_BUDGET_MS = 45_000;

async function sendHowWasIt(redis: ReturnType<typeof getRedis>, site: string, startedAt: number) {
  const db = getDb();
  const ended = yesterdayIso();
  if (!db) return { ended, candidates: 0, sent: 0, failed: 0 };
  let candidates: Awaited<ReturnType<typeof tripsEndedOn>> = [];
  try {
    candidates = await tripsEndedOn(db, ended);
  } catch (e) {
    console.error("[how-was-it] could not list trips:", e instanceof Error ? e.message.slice(0, 200) : e);
    return { ended, candidates: 0, sent: 0, failed: 1 };
  }
  let sent = 0;
  let failed = 0;
  // One email per address per evening, however many trips ended: the
  // first one asks, a second would be nagging.
  const asked = new Set<string>();
  let skipped = 0;
  for (const trip of candidates.slice(0, 500)) {
    if (asked.has(trip.ownerEmail)) continue;
    if (Date.now() - startedAt > SEND_BUDGET_MS) {
      skipped++;
      continue;
    }
    try {
      const claimed = await redis.set(howWasItSentKey(trip.jobId), "1", { nx: true, ex: 30 * 24 * 3600 });
      if (claimed !== "OK") continue;
      const email = howWasItEmailFor({ site, jobId: trip.jobId, destinations: trip.destinations, language: trip.language });
      try {
        await sendItineraryEmail(trip.ownerEmail, email.subject, email.html);
      } catch (e) {
        await redis.del(howWasItSentKey(trip.jobId)).catch(() => {});
        throw e;
      }
      asked.add(trip.ownerEmail);
      sent++;
    } catch (e) {
      failed++;
      console.error(`[how-was-it] ${trip.jobId}:`, e instanceof Error ? e.message : e);
    }
  }
  if (skipped) console.warn(`[how-was-it] out of time: ${skipped} trips not asked`);
  return { ended, candidates: candidates.length, sent, failed, skipped };
}
