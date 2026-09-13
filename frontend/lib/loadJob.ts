// Server-only helper for reading a job straight from Redis - used by the
// trip page's generateMetadata and its opengraph-image, both of which need
// the job's content before the client ever polls GET /api/job/[id].

import { getRedis } from "./redis";
import { jobKey, readJobRecord, type Job } from "./jobs";

export async function loadJob(jobId: string): Promise<Job | null> {
  try {
    const redis = getRedis();
    // Validated, not asserted. This used to be
    // `typeof raw === "string" ? JSON.parse(raw) : raw` with the Job type
    // written on the return, and the callers are generateMetadata, the
    // opengraph image and the showcase gallery - all of which then read
    // `job.result.trip_summary` and `job.status`. A malformed record was a
    // throw during render of a shared trip link, which the catch here turns
    // into "not found" instead. See readJobRecord.
    return readJobRecord(await redis.get<string | Job>(jobKey(jobId)));
  } catch {
    return null;
  }
}
