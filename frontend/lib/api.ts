import type { Itinerary, TripBriefInput } from "./types";
import type { Job, JobTimings, QualityReport } from "./jobs";
import type { FeedbackEntry } from "./feedback";
import { getTestModeKey, TEST_MODE_HEADER } from "./testMode";

export class ApiError extends Error {}

// 800ms, not 2s: this is dead time bolted onto the END of every generation
// — the job can finish a full interval before the next poll notices, so a
// 2s interval was adding up to 2s of pure waiting to a number that's
// already the thing travelers complain about. A poll is a single cheap
// Redis read, so the extra requests cost far less than the latency they
// remove.
// Half of this is dead time on every generation: the job is finished and
// sitting in Redis while the client waits out the rest of its sleep. At 800
// that averaged ~400ms of pure lag on the traveler's clock for no reason
// beyond saving a handful of Upstash reads per run.
const POLL_INTERVAL_MS = 400;
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes — generous now that generation runs in the worker, unconstrained by a serverless timeout

async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // response body wasn't JSON — keep the fallback message
  }
  return fallback;
}

/** Polls GET /api/job/[id] until it's done. `onStatus` is called on every
 * poll so the UI can show progress ("queued" / "generating...") — it also
 * receives the job's brief on every call (not just once done), since the
 * brief is written at job-creation time and is available from the very
 * first poll. This lets the loading screen show destination-aware content
 * (see LoadingScreen's city-facts rotation) before generation finishes, not
 * just after. Shared by refineItinerary below and by the /trip/[jobId] page,
 * which polls a job it didn't create itself (loaded straight from a shared
 * link). Also returns the brief alongside the final result since a page
 * loading a job cold — rather than holding the brief in form state already —
 * needs it to submit a pushback. */
export async function pollJob(
  jobId: string,
  onStatus?: (status: Job["status"], brief: TripBriefInput) => void
): Promise<{ jobId: string; itinerary: Itinerary; brief: TripBriefInput; timings?: JobTimings; quality?: QualityReport }> {
  const start = Date.now();
  for (;;) {
    const jobResponse = await fetch(`/api/job/${jobId}`);
    if (!jobResponse.ok) {
      throw new ApiError(
        await readErrorDetail(jobResponse, `Could not check job status (status ${jobResponse.status}).`)
      );
    }

    const job = (await jobResponse.json()) as Job;
    onStatus?.(job.status, job.brief);

    if (job.status === "done") {
      if (!job.result) throw new ApiError("Job finished but returned no result.");
      // timings ride along so the owner-only diagnostics panel can show
      // where the wall time actually went (see components/JobTimings.tsx).
      return { jobId, itinerary: job.result, brief: job.brief, timings: job.timings, quality: job.quality };
    }
    if (job.status === "error") {
      throw new ApiError(job.error ?? "Generation failed.");
    }

    if (Date.now() - start > MAX_WAIT_MS) {
      throw new ApiError("This is taking much longer than expected — try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Enqueues a generation job and returns its id immediately, without
 * polling — the caller (the trip form) navigates to /trip/[jobId] right
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
 * comes back. The returned itinerary replaces the caller's current one —
 * including its own pushback_response — so a second pushback builds on the
 * latest revision rather than the original. */
export async function refineItinerary(
  brief: TripBriefInput,
  itinerary: Itinerary,
  question: string,
  onStatus?: (status: Job["status"]) => void
): Promise<{ jobId: string; itinerary: Itinerary; brief: TripBriefInput; timings?: JobTimings; quality?: QualityReport }> {
  const createResponse = await fetch("/api/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, itinerary, question }),
  });

  if (!createResponse.ok) {
    throw new ApiError(
      await readErrorDetail(createResponse, `Request failed with status ${createResponse.status}.`)
    );
  }

  const { jobId } = (await createResponse.json()) as { jobId: string };
  return pollJob(jobId, onStatus);
}

/** Submits feedback on one itinerary line item. Swallows nothing — throws
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
