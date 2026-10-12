import type { Itinerary, TripBriefInput } from "./types";
import type { Job, JobTimings, QualityReport, JobProgress } from "./jobs";
import type { PublicJob, PublicTripBrief } from "./publicBrief";
import type { FeedbackEntry } from "./feedback";
import { getTestModeKey, TEST_MODE_HEADER } from "./testMode";
import { tripFailureReason, type TripFailureReason } from "./tripFailure";

/** A failure the UI can act on, not just print.
 *
 * `reason` was the missing half. Every failure of a trip page arrived here
 * as a string, so the four quite different things that can go wrong - the
 * link is old, the worker restarted, nothing is reading the queue, the
 * record is from an older build - rendered identically and offered the
 * same single action. They do not want the same action; one of them is the
 * only case where trying again is worth a generation, and another is the
 * case where trying again is actively bad advice. See lib/tripFailure.ts.
 *
 * Optional, because this error is thrown from paths that have no HTTP
 * response behind them at all. */
export class ApiError extends Error {
  readonly reason?: TripFailureReason;
  constructor(message: string, reason?: TripFailureReason) {
    super(message);
    this.reason = reason;
  }
}

// 800ms, not 2s: this is dead time bolted onto the END of every generation
// - the job can finish a full interval before the next poll notices, so a
// 2s interval was adding up to 2s of pure waiting to a number that's
// already the thing travelers complain about. A poll is a single cheap
// Redis read, so the extra requests cost far less than the latency they
// remove.
// Half of this is dead time on every generation: the job is finished and
// sitting in Redis while the client waits out the rest of its sleep. At 800
// that averaged ~400ms of pure lag on the traveler's clock for no reason
// beyond saving a handful of Upstash reads per run.
const POLL_INTERVAL_MS = 400;
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes - generous now that generation runs in the worker, unconstrained by a serverless timeout

async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  return (await readError(response, fallback)).detail;
}

/** The sentence AND the code behind a failed response.
 *
 * The route writes better sentences than a client-side lookup table could,
 * so the sentence is still what gets read; the code is what decides which
 * actions the page offers. A body that is not this route's own (a proxy's
 * HTML error page, say) falls back to the status, which tripFailureReason
 * knows how to read. */
async function readError(
  response: Response,
  fallback: string
): Promise<{ detail: string; reason: TripFailureReason }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON - keep the fallback message and judge by the status alone.
  }
  const b = (body ?? {}) as { detail?: unknown; reason?: unknown };
  return {
    detail: typeof b.detail === "string" ? b.detail : fallback,
    reason: tripFailureReason({ status: response.status, reason: b.reason }),
  };
}

/** Polls GET /api/job/[id] until it's done. `onStatus` is called on every
 * poll so the UI can show progress ("queued" / "generating...") - it also
 * receives the job's brief on every call (not just once done), since the
 * brief is written at job-creation time and is available from the very
 * first poll. This lets the loading screen show destination-aware content
 * (see LoadingScreen's city-facts rotation) before generation finishes, not
 * just after. Shared by refineItinerary below and by the /trip/[jobId] page,
 * which polls a job it didn't create itself (loaded straight from a shared
 * link).
 *
 * The brief this returns is a PublicTripBrief, not the whole thing. It used
 * to be the whole thing, because refineItinerary needed to post it back -
 * which meant a public, shareable endpoint published the traveler's
 * disability disclosures, dietary constraints, budget and home city to
 * anyone holding the link. /api/refine reads the brief from the job record
 * itself now, so what crosses the wire is only what the page renders. See
 * lib/publicBrief.ts. */
export async function pollJob(
  jobId: string,
  // `retried` rides along because the stall case throws: by the time the
  // caller has an error it no longer has the response, and whether this
  // trip has already spent its one free retry decides whether the failure
  // view offers a Try again button at all. onStatus is called before the
  // status checks, so it still sees it.
  onStatus?: (
    status: Job["status"],
    brief: PublicTripBrief,
    progress?: JobProgress,
    retried?: boolean
  ) => void
): Promise<{
  jobId: string;
  itinerary: Itinerary;
  brief: PublicTripBrief;
  timings?: JobTimings;
  quality?: QualityReport;
}> {
  const start = Date.now();
  for (;;) {
    // A fetch that never completes is not a statement about the trip -
    // it is a statement about the network - and it used to be reported
    // with the same words as an expired link.
    let jobResponse: Response;
    try {
      jobResponse = await fetch(`/api/job/${jobId}`);
    } catch {
      throw new ApiError(
        "We could not reach the planner. Check your connection and try again.",
        "unreachable"
      );
    }
    if (!jobResponse.ok) {
      const failure = await readError(jobResponse, `Could not check job status (status ${jobResponse.status}).`);
      throw new ApiError(failure.detail, failure.reason);
    }

    const job = (await jobResponse.json()) as PublicJob;
    onStatus?.(job.status, job.brief, job.progress, job.retried);

    if (job.status === "done") {
      if (!job.result) throw new ApiError("Job finished but returned no result.");
      // timings ride along so the owner-only diagnostics panel can show
      // where the wall time actually went (see components/JobTimings.tsx).
      return { jobId, itinerary: job.result, brief: job.brief, timings: job.timings, quality: job.quality };
    }
    if (job.status === "error") {
      // The route distinguishes an interrupted generation from a queue
      // nothing is reading, and sends the code along; "failed" is the
      // fallback for a worker-recorded error with no code on it.
      throw new ApiError(job.error ?? "Generation failed.", tripFailureReason({ reason: job.reason }));
    }

    if (Date.now() - start > MAX_WAIT_MS) {
      // Its own reason, because the job behind it is very likely still
      // running: the thing to do is look again, not start a second one.
      throw new ApiError("This is taking much longer than expected - try again shortly.", "timed_out");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Starts a dropped generation again, returning the NEW job's id.
 *
 * Takes only the id: the brief it regenerates from is read out of the job
 * record server-side, because what this page holds is a PublicTripBrief
 * with the mobility, dietary, budget and origin fields deliberately
 * stripped - so a retry assembled here would have quietly generated a
 * different trip. See app/api/job/[id]/retry and lib/publicBrief.ts.
 *
 * This COSTS a real generation. Only offered where trying again has a
 * genuine chance of working (lib/tripFailure.ts's canRetry), and the
 * button that calls it says what it spends. */
export async function retryTrip(jobId: string): Promise<string> {
  const response = await fetch(`/api/job/${jobId}/retry`, { method: "POST" });
  if (!response.ok) {
    const failure = await readError(response, `Could not start that trip again (status ${response.status}).`);
    throw new ApiError(failure.detail, failure.reason);
  }
  const { jobId: retryJobId } = (await response.json()) as { jobId: string };
  return retryJobId;
}

/** Enqueues a generation job and returns its id immediately, without
 * polling - the caller (the trip form) navigates to /trip/[jobId] right
 * away and lets that page own polling, so the result has a shareable,
 * bookmarkable URL from the moment generation starts. */
export async function createGenerateJob(brief: TripBriefInput): Promise<string> {
  const testModeKey = getTestModeKey();
  const createResponse = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(testModeKey ? { [TEST_MODE_HEADER]: testModeKey } : {}),
    },
    body: JSON.stringify(brief),
  });

  if (!createResponse.ok) {
    throw new ApiError(
      await readErrorDetail(createResponse, `Request failed with status ${createResponse.status}.`)
    );
  }

  const { jobId } = (await createResponse.json()) as { jobId: string };
  return jobId;
}

/** Submits a pushback/follow-up question about an already-generated
 * itinerary and polls until the model's revision (or justified refusal)
 * comes back. The returned itinerary replaces the caller's current one -
 * including its own pushback_response - so a second pushback builds on the
 * latest revision rather than the original.
 *
 * Takes the job's ID, not its brief and itinerary. Those used to be posted
 * from here, which is why the polling endpoint had to publish the full
 * brief in the first place; /api/refine reads both out of the job record
 * now. Pass the CURRENT job id, which after a refinement is the refined
 * one - that is what makes a second pushback build on the latest revision
 * rather than on the original. */
export async function refineItinerary(
  jobId: string,
  question: string,
  onStatus?: (status: Job["status"]) => void
): Promise<{
  jobId: string;
  itinerary: Itinerary;
  brief: PublicTripBrief;
  timings?: JobTimings;
  quality?: QualityReport;
}> {
  const createResponse = await fetch("/api/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, question }),
  });

  if (!createResponse.ok) {
    throw new ApiError(
      await readErrorDetail(createResponse, `Request failed with status ${createResponse.status}.`)
    );
  }

  const { jobId: refinedJobId } = (await createResponse.json()) as { jobId: string };
  return pollJob(refinedJobId, onStatus);
}

/** Submits feedback on one itinerary line item. Swallows nothing - throws
 * ApiError on failure so the UI can show a real error instead of silently
 * pretending the feedback was recorded. */
export async function submitFeedback(entry: Omit<FeedbackEntry, "id" | "createdAt">): Promise<void> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new ApiError(
      await readErrorDetail(response, `Feedback submission failed (status ${response.status}).`)
    );
  }
}
