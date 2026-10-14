// Rendering and sending a finished trip by email, in one place.
//
// Three routes send a trip now: "Email it to me" on the trip page, and the
// two halves of "Email me when it's ready" on the wait screen. They must
// send the same email and fail the same way, so the rendering lives here.
//
// The address is always a parameter that the caller took from the session
// (or from the record the session wrote) - never from a request body. See
// app/api/trip-email/route.ts for why that matters.

import type { Redis } from "@upstash/redis";
import { sendItineraryEmail } from "./email";
import { itineraryEmailFor } from "./itineraryEmail";
import { readJobRecord, readTripReadyNotify, jobKey, tripReadyNotifyKey, type Job } from "./jobs";
import type { Language } from "./types";

/** Throws what sendItineraryEmail throws. */
export async function sendTripEmail(job: Job, email: string, site: string): Promise<void> {
  if (job.status !== "done" || !job.result) throw new Error("The trip has not finished.");
  const destinations = Array.isArray(job.brief?.destinations) ? job.brief.destinations : [];
  const language: Language = job.brief?.language === "bg" ? "bg" : "en";
  const { subject, html } = itineraryEmailFor({
    itinerary: job.result,
    tripUrl: `${site}/trip/${job.id}`,
    destinations,
    language,
  });
  await sendItineraryEmail(email, subject, html);
}

export type DeliverOutcome = "sent" | "not-done" | "nothing-pending";

/** Sends the "when it's ready" email if the job is done and someone asked.
 *
 * The order is the whole design. Status is checked BEFORE the claim, so an
 * early or stray call to the ready route cannot use the request up while
 * the trip is still generating. Then GETDEL claims it, which only one
 * caller can win - the worker's ping or the site noticing the job already
 * finished - so the email goes once.
 *
 * If the send itself fails after the claim, the claim is put back so the
 * next attempt (the trip page's own poll, see the notify route) can try
 * again. */
export async function deliverTripReady(redis: Redis, jobId: string, site: string): Promise<DeliverOutcome> {
  const job = readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
  if (!job || job.status !== "done" || !job.result) return "not-done";

  const raw = await redis.getdel<string | object>(tripReadyNotifyKey(jobId));
  const notify = readTripReadyNotify(raw);
  if (!notify) return "nothing-pending";

  try {
    await sendTripEmail(job, notify.email, site);
  } catch (e) {
    await redis
      .set(tripReadyNotifyKey(jobId), JSON.stringify(notify), { ex: 15 * 60 })
      .catch(() => {});
    throw e;
  }
  return "sent";
}
