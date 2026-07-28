import type { Itinerary, TripBriefInput } from "./types";
import type { Job } from "./jobs";
import type { FeedbackEntry } from "./feedback";

export class ApiError extends Error {}

const POLL_INTERVAL_MS = 2000;
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
 * poll so the UI can show progress ("queued" / "generating..."). Shared by
 * generateItinerary and refineItinerary below — both just differ in how the
 * job gets created. */
async function pollJob(
  jobId: string,
  onStatus?: (status: Job["status"]) => void
): Promise<{ jobId: string; itinerary: Itinerary }> {
  const start = Date.now();
  for (;;) {
    const jobResponse = await fetch(`/api/job/${jobId}`);
    if (!jobResponse.ok) {
      throw new ApiError(
        await readErrorDetail(jobResponse, `Could not check job status (status ${jobResponse.status}).`)
      );
    }

    const job = (await jobResponse.json()) as Job;
    onStatus?.(job.status);

    if (job.status === "done") {
      if (!job.result) throw new ApiError("Job finished but returned no result.");
      return { jobId, itinerary: job.result };
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

/** Kicks off generation and polls until it's done. Returns the jobId
 * alongside the result so the caller can attribute feedback (submitFeedback
 * below) to the job that produced each item. */
export async function generateItinerary(
  brief: TripBriefInput,
  onStatus?: (status: Job["status"]) => void
): Promise<{ jobId: string; itinerary: Itinerary }> {
  const createResponse = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(brief),
  });

  if (!createResponse.ok) {
    throw new ApiError(
      await readErrorDetail(createResponse, `Request failed with status ${createResponse.status}.`)
    );
  }

  const { jobId } = (await createResponse.json()) as { jobId: string };
  return pollJob(jobId, onStatus);
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
): Promise<{ jobId: string; itinerary: Itinerary }> {
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
