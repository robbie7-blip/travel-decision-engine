import type { Itinerary, TripBriefInput } from "./types";
import type { Job } from "./jobs";

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

/** Kicks off generation and polls until it's done. `onStatus` is called on
 * every poll so the UI can show progress ("queued" / "generating..."). */
export async function generateItinerary(
  brief: TripBriefInput,
  onStatus?: (status: Job["status"]) => void
): Promise<Itinerary> {
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
      return job.result;
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
