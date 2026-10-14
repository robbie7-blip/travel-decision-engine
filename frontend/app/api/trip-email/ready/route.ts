// The worker's "this job has finished" ping, for "Email me when it's
// ready" (see TripReadyNotify in lib/jobs.ts).
//
// NO SECRET, AND THAT IS SAFE BY CONSTRUCTION: the body is a job id and
// nothing else. The route does nothing at all for a job that is not done,
// and for one that is, the only thing it can do is send the email that
// was requested, once (GETDEL), to the address the requester's own
// session wrote. A stranger calling it can at worst make that email arrive
// a few seconds sooner.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { EmailNotConfiguredError, EmailSendFailedError } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";
import { deliverTripReady } from "@/lib/tripEmailSend";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  try {
    const outcome = await deliverTripReady(redis, jobId, getSiteUrl());
    return NextResponse.json({ outcome });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      console.error("[trip-email/ready] not configured:", e.message);
      return NextResponse.json({ detail: "Email is not configured." }, { status: 503 });
    }
    if (e instanceof EmailSendFailedError) {
      console.error(`[trip-email/ready] Resend refused (HTTP ${e.httpStatus}): ${e.reason}`);
      return NextResponse.json({ detail: "Send failed." }, { status: 502 });
    }
    console.error("[trip-email/ready] unexpected failure:", e);
    return NextResponse.json({ detail: "Send failed." }, { status: 500 });
  }
}
