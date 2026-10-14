// "Email me when it's ready", asked for on the wait screen.
//
// Records the request (the session's own address, and where the worker
// should ping) and returns at once. The worker pings the ready route when
// the job is saved as done; if the job has ALREADY finished by the time
// this runs, it is delivered from here instead. Either way the GETDEL in
// deliverTripReady makes it exactly one email. See TripReadyNotify in
// lib/jobs.ts.
//
// Same guards as /api/trip-email: same-origin, a session, the auth rate
// limit, and no address taken from the body.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { readJobRecord, jobKey, tripReadyNotifyKey, TRIP_READY_NOTIFY_TTL_SECONDS, type Job } from "@/lib/jobs";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { checkRateLimit, getClientIp, AUTH_RATE_LIMIT } from "@/lib/ratelimit";
import { EmailNotConfiguredError } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";
import { deliverTripReady } from "@/lib/tripEmailSend";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const site = getSiteUrl();

  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, site))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }

  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) {
    return NextResponse.json({ detail: "Sign in first - we send this to the address on your account." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId || jobId.length > 100) {
    return NextResponse.json({ detail: "That is not a valid trip id." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const limit = await checkRateLimit(redis, getClientIp(request), AUTH_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json({ detail: `Too many requests - ${limit.reason}.` }, { status: 429 });
  }

  const job = readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
  if (!job) {
    return NextResponse.json({ detail: "That trip could not be found - it may have expired." }, { status: 404 });
  }
  if (job.status === "error") {
    return NextResponse.json({ detail: "That trip did not finish, so there is nothing to send." }, { status: 409 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    // Said now, while they are still looking, rather than discovered as
    // an email that never came.
    return NextResponse.json({ detail: "Email is not configured on this deployment." }, { status: 503 });
  }

  // The ping goes to the configured site, not to the host this request
  // reports: behind a proxy, Next's own idea of its origin can be an
  // internal name the worker cannot reach (measured locally: a request to
  // 127.0.0.1 reported itself as localhost). The site URL is also what the
  // email's own link uses.
  const url = new URL("/api/trip-email/ready", site).toString();
  await redis.set(
    tripReadyNotifyKey(jobId),
    JSON.stringify({ email, url, requestedAt: Date.now() }),
    { ex: TRIP_READY_NOTIFY_TTL_SECONDS }
  );

  // Already finished (or finished a moment ago, between the worker's ping
  // and this write): deliver here. Nobody else will.
  try {
    const outcome = await deliverTripReady(redis, jobId, site);
    if (outcome === "sent") return NextResponse.json({ status: "sent" });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      return NextResponse.json({ detail: "Email is not configured on this deployment." }, { status: 503 });
    }
    return NextResponse.json({ detail: "That did not send. Try again in a moment." }, { status: 502 });
  }

  return NextResponse.json({ status: "scheduled" });
}
