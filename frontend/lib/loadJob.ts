// Server-only helper for reading a job straight from Redis - used by the
// trip page's generateMetadata and its opengraph-image, both of which need
// the job's content before the client ever polls GET /api/job/[id].

import { getRedis } from "./redis";
import { jobKey, type Job } from "./jobs";

export async function loadJob(jobId: string): Promise<Job | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get<string | Job>(jobKey(jobId));
    if (raw == null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
