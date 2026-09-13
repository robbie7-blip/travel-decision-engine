// Polling endpoint for async generation jobs. Returns the job's current
// status/result as written by the worker (worker/src/index.ts) - this route
// itself never talks to Anthropic.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { jobKey, readJobRecord, stallReason, WORKER_HEARTBEAT_KEY, type Job, type WorkerHeartbeat } from "@/lib/jobs";
import { isWorkerHeartbeat } from "@/lib/health";
import { touchJobTtl } from "@/lib/jobTtl";

export const runtime = "nodejs";

/** True when a worker is currently heartbeating.
 *
 * The heartbeat key carries a TTL and nothing renews it but a live process,
 * so its presence is the only direct evidence this deployment has that the
 * worker exists at all (see the note above WORKER_HEARTBEAT_KEY in jobs.ts).
 *
 * A read failure returns null, not false: "we could not ask" must not be
 * reported to a traveler as "the planner is down". */
async function workerIsAlive(redis: {
  get: <T>(key: string) => Promise<T | null>;
}): Promise<boolean | null> {
  try {
    const raw = await redis.get<string | WorkerHeartbeat>(WORKER_HEARTBEAT_KEY);
    if (raw == null) return false;
    const beat = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isWorkerHeartbeat(beat);
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json(
      { detail: "Server is misconfigured (job queue is not set up)." },
      { status: 500 }
    );
  }

  const raw = await redis.get<string | Job>(jobKey(id));
  if (raw == null) {
    return NextResponse.json(
      { detail: "Job not found - it may have expired or the id is invalid." },
      { status: 404 }
    );
  }

  // Validated rather than asserted. This was
  // `typeof raw === "string" ? JSON.parse(raw) : raw` with `: Job` written
  // on it and no try around the parse - see readJobRecord in lib/jobs.ts
  // for what each malformed shape did. The 500 is deliberate and is the
  // kind the client handles well: pollJob throws ApiError with this exact
  // `detail`, so the traveller reads a sentence instead of watching a
  // spinner run out the full five minutes.
  const job = readJobRecord(raw);
  if (!job) {
    return NextResponse.json(
      {
        detail:
          "This trip's record could not be read - it may have been written by an older version. " +
          "Please generate it again.",
      },
      { status: 500 }
    );
  }

  // Opening a finished trip keeps it.
  //
  // The lifetime on the record answers "how long is this kept without
  // being looked at". This answers the other question - a trip somebody is
  // still using must not expire underneath them - and that is the one that
  // bites on a trip opened during the holiday it describes, a year after
  // it was planned. Not awaited: it is bookkeeping about next year, and
  // the traveller is waiting for this response now.
  void touchJobTtl(redis, job);

  // A job that nothing is going to finish - either its worker died
  // mid-generation and left it at "running", or no worker ever took it off
  // the queue and it is still "pending". Reporting it as an error here is
  // what turns a five-minute spinner into something the traveler can act
  // on. Deliberately not written back to Redis: this route is a reader, and
  // if the worker is somehow still alive it should keep its own record.
  //
  // The two cases get different words on purpose. Telling someone to try
  // again is good advice after an interrupted run and useless advice when
  // the queue has no consumer - a retry there just buys them another five
  // minutes of spinner.
  const stall = stallReason(job);

  // "Still pending after 90s" does NOT mean nothing is consuming the queue.
  //
  // The worker runs WORKER_CONCURRENCY consumers (4 by default) and a real
  // generation takes the better part of a minute, so the fifth simultaneous
  // submission legitimately waits behind the first four - and was being
  // told "the trip planner is offline right now, so this never started"
  // while its job sat in a live queue and then ran to completion at full
  // cost. Every traveler who believed that message and resubmitted
  // commissioned a second real generation, which lengthened the queue,
  // which made the next one wait longer.
  //
  // The heartbeat is the fact that settles it: if a worker is writing one,
  // the queue has a consumer and this job is queued, not abandoned. So it
  // is left alone as "pending" and the page keeps waiting.
  //
  // Checked only on the pending verdict. A restart mid-generation is a real
  // dead job whether or not the worker came back up afterwards, so the
  // heartbeat says nothing useful about it.
  if (stall === "worker_offline") {
    const alive = await workerIsAlive(redis);
    // null (the read failed) falls through to the offline message, same as
    // before - we can't prove the worker is there, and a job this old with
    // no evidence of a consumer is more likely stalled than queued.
    if (alive === true) {
      return NextResponse.json(job);
    }
  }

  if (stall) {
    return NextResponse.json({
      ...job,
      status: "error",
      // Neither message claims "nothing was charged" any more, because that
      // wasn't true. Quota is consumed at enqueue (see consumeQuota in
      // /api/generate) and is not given back here - this route is a reader,
      // and polling means it would run several times per stalled job. An
      // interrupted generation has also already spent real model calls. The
      // honest version says what happened and what to do; overstating it
      // ("nothing was charged") is the kind of reassurance that turns into
      // a support conversation about a missing generation slot.
      error:
        stall === "worker_restarted"
          ? "This generation stopped unexpectedly - the server restarted while it was running. Please try again."
          : "The trip planner isn't picking up new trips right now, so this one never started. We're on it - please try again shortly.",
    } satisfies Job);
  }

  return NextResponse.json(job);
}
