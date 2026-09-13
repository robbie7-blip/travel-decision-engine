// Whether a stored job can be refined, and with what.
//
// Extracted from /api/refine rather than left inline, for one reason: no
// route handler in this app has a test, because driving one means standing
// up Next's request plumbing and a Redis client that reads process.env. The
// decisions this makes are the whole of what changed when /api/refine
// stopped taking the brief and the itinerary from the request body - so
// they live here, as a pure function of the raw Redis value, and the route
// keeps only the plumbing.
//
// What it decides:
//
//   - whether the value out of Redis is a job at all (readJobRecord)
//   - whether it has FINISHED, because a refinement quotes the itinerary
//     back to the model and a pending job has none
//   - whether its stored brief still passes the validator that admitted it
//
// That last one is not paranoia about our own writes. isJob (lib/jobs.ts)
// checks only that `brief` is a non-null object, records live for up to 400
// days, and this brief goes straight into a model prompt. A brief that
// fails parseTripBrief here was already wrong when it was stored, and the
// honest answer is to say so rather than to prompt the model with it.
//
// Run: npm run test:refine-source

import { readJobRecord, type Job } from "./jobs";
import { parseTripBrief, ValidationError } from "./validation";
import type { Itinerary, TripBriefInput } from "./types";

export type RefineSource =
  | { ok: true; job: Job; brief: TripBriefInput; baseItinerary: Itinerary }
  | { ok: false; status: 404 | 409 | 422; detail: string };

/** The trip a refinement will be built from, or why it cannot be.
 *
 * Statuses are distinct on purpose, because the three have different advice
 * attached and a traveller acting on the wrong one wastes a generation:
 * 404 means gone (start again), 409 means not yet (wait), 422 means the
 * record is unusable (start again, and this one will not fix itself). */
export function refineSource(raw: unknown): RefineSource {
  const job = readJobRecord(raw);
  if (!job) {
    return {
      ok: false,
      status: 404,
      detail: "That trip could not be found - it may have expired. Please generate it again.",
    };
  }

  // A refinement prompt quotes the existing itinerary ("here is the
  // itinerary you produced"), so there has to be one. Checking `result`
  // as well as `status` rather than trusting the pair to agree: a "done"
  // job with no result is exactly the shape pollJob already refuses on the
  // client, and it would arrive here as `baseItinerary: undefined` cast
  // into a prompt.
  if (job.status !== "done" || !job.result) {
    return {
      ok: false,
      status: 409,
      detail: "That trip hasn't finished generating yet - please wait for it and try again.",
    };
  }

  let brief: TripBriefInput;
  try {
    brief = parseTripBrief(job.brief);
  } catch (e) {
    return {
      ok: false,
      status: 422,
      detail:
        e instanceof ValidationError
          ? `That trip's brief can no longer be read (${e.message}) - please generate it again.`
          : "That trip's brief can no longer be read - please generate it again.",
    };
  }

  return { ok: true, job, brief, baseItinerary: job.result };
}
