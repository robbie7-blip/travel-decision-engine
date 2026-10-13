// Sends a finished itinerary to the address on the account.
//
// ONLY EVER TO THAT ADDRESS, and that is the whole security design rather
// than a precaution. A trip link is a public capability - the job id IS
// the credential, and handing someone the link is how sharing works here
// (see lib/publicBrief.ts). So a route that took an email address in its
// body would be a way to send mail from this domain to anywhere, which is
// an open relay with extra steps: spam, and a phishing primitive that
// arrives from a real, verified sender.
//
// Taking the address from the session instead makes the feature exactly
// what its button says - "email it to me" - and makes abuse self-targeted.
// The address is also already verified, because the only way to get a
// session is to click a magic link sent to it.
//
// Rate limited against AUTH_RATE_LIMIT rather than a budget of its own:
// this and the sign-in email draw on the same Resend quota, so they should
// draw on the same allowance.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { readJobRecord, jobKey, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { checkRateLimit, getClientIp, AUTH_RATE_LIMIT } from "@/lib/ratelimit";
import { EmailNotConfiguredError, EmailSendFailedError, sendItineraryEmail } from "@/lib/email";
import { itineraryEmailFor } from "@/lib/itineraryEmail";
import { getSiteUrl } from "@/lib/siteUrl";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const site = getSiteUrl();

  // A POST that sends mail, so it only runs for this site's own pages.
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, site))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }

  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) {
    // 401 and nothing else: there is no address to send to, and the page
    // turns this into "sign in and we can email this to you".
    return NextResponse.json({ detail: "Sign in first - we send this to the address on your account." }, { status: 401 });
  }

  let jobId: string;
  try {
    const body = (await request.json()) as { jobId?: unknown };
    jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }
  // Bounded before it becomes a Redis key, same shape check /api/refine
  // makes on an id it is handed.
  if (!jobId || jobId.length > 100) {
    return NextResponse.json({ detail: "That is not a valid trip id." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  // Before the Redis read, so looking a trip id up is never cheaper than
  // sending - the same ordering /api/refine documents.
  const limit = await checkRateLimit(redis, getClientIp(request), AUTH_RATE_LIMIT);
  if (!limit.allowed) {
    const minutes = Math.ceil((limit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many requests - ${limit.reason}. Try again in ~${minutes} minute(s).` },
      { status: 429, headers: limit.retryAfterSeconds ? { "Retry-After": String(limit.retryAfterSeconds) } : undefined }
    );
  }

  const job = readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
  if (!job) {
    return NextResponse.json({ detail: "That trip could not be found - it may have expired." }, { status: 404 });
  }
  if (job.status !== "done" || !job.result) {
    return NextResponse.json({ detail: "That trip has not finished generating yet." }, { status: 409 });
  }

  // From the job record, not from the request: the destinations and the
  // language that generated the trip, not whatever a caller claims.
  const destinations = Array.isArray(job.brief?.destinations) ? job.brief.destinations : [];
  const language: Language = job.brief?.language === "bg" ? "bg" : "en";
  const { subject, html } = itineraryEmailFor({
    itinerary: job.result,
    tripUrl: `${site}/trip/${jobId}`,
    destinations,
    language,
  });

  try {
    await sendItineraryEmail(email, subject, html);
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      console.error("[trip-email] not configured:", e.message);
      return NextResponse.json({ detail: "Email is not configured on this deployment." }, { status: 503 });
    }
    if (e instanceof EmailSendFailedError) {
      // Resend's own reason, logged rather than returned: it can name the
      // sending domain and the account's limits, which is for the owner
      // and /admin/health, not for a traveller.
      console.error(`[trip-email] Resend refused (HTTP ${e.httpStatus}): ${e.reason}`);
      return NextResponse.json({ detail: "That did not send. Try again in a moment." }, { status: 502 });
    }
    console.error("[trip-email] unexpected failure:", e);
    return NextResponse.json({ detail: "That did not send. Try again in a moment." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
