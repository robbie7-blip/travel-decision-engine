// Whether a stalled trip can be started again, and from what.
//
// A sibling of lib/refineSource.ts, written for the same reason: no route
// handler in this app has a test, because driving one means standing up
// Next's request plumbing and a Redis client that reads process.env. So the
// decisions live here, as a pure function of the raw Redis value, and
// /api/job/[id]/retry keeps only the plumbing.
//
// WHY A RETRY HAS TO BE SERVER-SIDE AT ALL. /api/job/[id] publishes a
// PublicTripBrief, which is a deliberate allowlist: mobility_constraints,
// dietary_constraints, hard_no, budget, origin, party size and the named
// hotel are all withheld, because a trip link is shareable and three of
// those are special-category personal data (see lib/publicBrief.ts). A
// retry button that re-posted what the page had would therefore generate a
// DIFFERENT trip - one with the wheelchair access, the coeliac diet and the
// budget quietly dropped - for precisely the travellers who most need them
// honoured, and it would look like it worked. The authoritative brief is in
// the job record, so the retry reads it from there and the full brief never
// leaves the server. /api/refine made the same move for the same reason.
//
// WHAT IT DECIDES:
//
//   - whether the value out of Redis is a job at all (readJobRecord)
//   - whether that job actually STALLED. A retry is not a "run it again"
//     button: it exists for a generation the server dropped. A job that is
//     merely young and still running must not be duplicated, because the
//     duplicate costs a real model call and the original is about to
//     finish.
//   - whether it has already been retried once, which is what stops one
//     free retry from becoming an unlimited one
//   - whether the stored brief still passes the validator that admitted
//     it, since that brief goes straight into a model prompt
//
// Run: npm run test:retry-source

import { readJobRecord, stallReason, type Job } from "./jobs";
import { parseTripBrief, ValidationError } from "./validation";
import type { TripBriefInput } from "./types";

export type RetrySource =
  | { ok: true; job: Job; brief: TripBriefInput }
  | { ok: false; status: 404 | 409 | 422 | 429; detail: string };

export function retrySource(raw: unknown): RetrySource {
  const job = readJobRecord(raw);
  if (!job) {
    return {
      ok: false,
      status: 404,
      detail: "That trip could not be found - it may have expired. Please plan a new one.",
    };
  }

  // Nothing to recover from.
  //
  // 409 rather than 400, and the wording matters: a finished trip is not an
  // error the traveller should be invited to fix, it is a trip. The page
  // never offers this button for one; the check is here because the route
  // is reachable without the page.
  if (job.status === "done") {
    return {
      ok: false,
      status: 409,
      detail: "That trip finished generating - there is nothing to retry.",
    };
  }

  // A retry is for a job the server dropped, not for one that is simply
  // taking a while. stallReason is the same judgement /api/job/[id] already
  // publishes to the traveller, so the button the page offers and the
  // request this accepts cannot disagree about whether a trip is dead.
  if (job.status !== "error" && !stallReason(job)) {
    return {
      ok: false,
      status: 409,
      detail: "That trip is still generating - give it a moment rather than starting a second one.",
    };
  }

  // ONE retry, not a tap that keeps spending.
  //
  // The first generation's quota slot was consumed at enqueue and is never
  // refunded (see /api/job/[id], which is explicit about not claiming
  // otherwise). Charging a second slot for the server's own crash would be
  // wrong; letting the retry be free without limit would make it a way
  // around the quota entirely - enqueue one trip, retry it forever. So the
  // record remembers, and the second attempt is the last free one.
  if (job.retriedAt !== undefined) {
    return {
      ok: false,
      status: 429,
      detail: "This trip has already been started again once. Plan a new one to try a different trip.",
    };
  }

  let brief: TripBriefInput;
  try {
    brief = parseTripBrief(job.brief);
  } catch (e) {
    // Not paranoia about our own writes: isJob (lib/jobs.ts) checks only
    // that `brief` is a non-null object, records live for up to 400 days,
    // and this brief goes straight into a model prompt. A brief that fails
    // here was already wrong when it was stored, and saying so beats
    // prompting the model with it.
    return {
      ok: false,
      status: 422,
      detail:
        e instanceof ValidationError
          ? `That trip's saved details are no longer valid (${e.message}). Please plan a new one.`
          : "That trip's saved details could not be read. Please plan a new one.",
    };
  }

  return { ok: true, job, brief };
}
