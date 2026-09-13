// What a shared trip link is allowed to disclose about the traveller.
//
// /api/job/[id] is PUBLIC and UNAUTHENTICATED - deliberately, because the
// trip page is meant to be shareable: it has its own OG image, its own
// share endpoints, and a lifetime measured in months so a traveller can
// reopen it during the holiday it describes. The job id is the capability,
// and handing someone the link is how the product works.
//
// It returned the entire job record, brief included. So sharing a trip also
// disclosed:
//
//   mobility_constraints   a disability disclosure, in the traveller's own
//                          words ("wheelchair user", "cannot manage stairs")
//   dietary_constraints    which in practice carries religion and medical
//                          conditions - halal, kosher, coeliac
//   hard_no                what they will not do, and often why
//   budget_total_eur       what they can afford
//   origin                 where they live
//   accommodation_location which hotel they are sleeping in, by name, on
//                          specific dates, when needs_lodging is false
//   party_size /           who is travelling with them
//   party_composition
//
// None of which the recipient of a shared itinerary has any business
// reading, and the first three of which are special-category personal data.
//
// So the response carries this instead: an ALLOWLIST of the fields the
// pages actually render. An allowlist rather than a redaction list on
// purpose - the failure mode of a denylist is the next field added to
// TripBriefInput, which would be published by default and by nobody's
// decision. Adding a field here is a choice somebody has to make.
//
// The refinement path used to be the reason the full brief had to be on the
// response ("a page loading a job cold needs it to submit a pushback", said
// lib/api.ts). It does not any more: /api/refine takes a job id and reads
// the authoritative brief out of the job record server-side, which is both
// safer and more correct - the brief that refines a trip is now the one
// that generated it, rather than whatever the client posted back.
//
// Run: npm run test:public-brief

import type { Job } from "./jobs";
import type { Language, TripBriefInput } from "./types";

/** Exactly the brief fields a trip page renders.
 *
 * Every one of these is already visible in the itinerary itself, which is
 * the test applied to decide what belongs here: the destinations are the
 * title, the dates are on every day, the party composition and interests
 * are shown back to the traveller as "what this was planned for", and the
 * language is what the whole page is written in. Nothing here tells a
 * reader something the trip does not already tell them. */
export interface PublicTripBrief {
  destinations: string[];
  start_date: string;
  end_date: string;
  party_composition: string;
  interests: string[];
  language: Language;
}

/** The fields, as data, so the test can assert that nothing outside this
 * list can reach a public response without this constant changing. */
export const PUBLIC_BRIEF_FIELDS = [
  "destinations",
  "start_date",
  "end_date",
  "party_composition",
  "interests",
  "language",
] as const;

/** Narrows a stored brief to what a shared link may show.
 *
 * Tolerant of a malformed stored brief rather than throwing: this runs on
 * the polling path, where the alternative to a slightly thin header is a
 * traveller who cannot open their own finished trip. isJob only checks that
 * `brief` is an object (see lib/jobs.ts), so a record written by an older
 * version really can be missing any of these. */
export function publicBrief(brief: unknown): PublicTripBrief {
  const b = (brief && typeof brief === "object" ? brief : {}) as Partial<TripBriefInput>;
  return {
    destinations: Array.isArray(b.destinations)
      ? b.destinations.filter((d): d is string => typeof d === "string")
      : [],
    start_date: typeof b.start_date === "string" ? b.start_date : "",
    end_date: typeof b.end_date === "string" ? b.end_date : "",
    party_composition: typeof b.party_composition === "string" ? b.party_composition : "",
    interests: Array.isArray(b.interests) ? b.interests.filter((i): i is string => typeof i === "string") : [],
    // Not defaulted to "en": the page's own language toggle and
    // localStorage both take precedence over this, and a stored brief with
    // no language is a record from before the field existed rather than an
    // English trip.
    language: b.language === "bg" || b.language === "en" ? b.language : "en",
  };
}

/** A job record as /api/job/[id] may serve it.
 *
 * `refinement` is gone as well as the brief's private half, for two
 * reasons. It holds the traveller's own question, and it holds
 * baseItinerary - an entire second copy of the pre-refinement trip, on a
 * response the page fetches every couple of seconds while it polls. No
 * client reads either.
 *
 * `testMode` is gone because it is an internal flag about which
 * guardrails were bypassed for this job. Nothing renders it, and it
 * answers a question about the operator rather than about the trip. */
export type PublicJob = Omit<Job, "brief" | "refinement" | "testMode"> & {
  brief: PublicTripBrief;
};

/** Built by naming every field, not by deleting two from a spread.
 *
 * `const { brief, refinement, ...rest } = job` would publish anything
 * later added to Job by default, which is the same failure the field
 * allowlist above exists to avoid - and the more dangerous version of it,
 * because a new top-level job field is exactly where a diagnostic or an
 * internal id would go. */
export function publicJob(job: Job): PublicJob {
  return {
    id: job.id,
    status: job.status,
    brief: publicBrief(job.brief),
    result: job.result,
    error: job.error,
    progress: job.progress,
    timings: job.timings,
    quality: job.quality,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ttlSeconds: job.ttlSeconds,
  };
}
