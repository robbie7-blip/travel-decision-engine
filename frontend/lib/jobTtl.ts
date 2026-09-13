// Extending a job's lifetime, and never shortening it by accident.
//
// Two call sites wanted "make sure this lives at least N seconds" and both
// spelled it `expire(key, N)`, which is not that - EXPIRE sets the TTL
// outright, in either direction. The admin curate routes bump a trip to
// CURATED_JOB_TTL_SECONDS (365 days) that way, and once a signed-in
// traveller's trip starts life at SAVED_JOB_TTL_SECONDS (400 days),
// curating it - promoting it to the showcase, the most deliberate thing an
// editor can do to a trip - would have quietly taken five weeks off it.
//
// Redis 7 has EXPIRE ... GT for exactly this, but reading the TTL first
// works on every server and every client wrapper, and the cost is one
// extra command on a path that already makes several.

import { ttlForJob, jobKey, type Job } from "./jobs";

/** Just the commands used here, so this file does not depend on which
 * Redis client the caller holds. */
interface TtlRedis {
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** How much a TTL has to have decayed before a refresh is worth a write.
 *
 * Without it, every page view of a saved trip writes: the key is set to
 * exactly SAVED_JOB_TTL_SECONDS and is below it a second later. A day of
 * slack means a trip opened five times in an afternoon costs one read and
 * no writes, and a trip opened once a month is topped back up to full
 * every time. */
const REFRESH_SLACK_SECONDS = 60 * 60 * 24;

/** Raises the key's TTL to `seconds` if it is currently lower.
 *
 * Returns what happened, for callers that want to say so. Never lowers a
 * TTL, and never gives a persistent key (TTL -1) an expiry it did not
 * have - a key somebody deliberately made permanent is not this
 * function's to put a clock on.
 *
 * Best-effort by contract: a trip lasting slightly less long is not worth
 * failing a page render or an admin action over, so a Redis failure here
 * resolves rather than throws. */
export async function extendTtl(
  redis: TtlRedis,
  key: string,
  seconds: number
): Promise<"extended" | "already-longer" | "missing" | "failed"> {
  if (!Number.isFinite(seconds) || seconds <= 0) return "failed";
  try {
    const current = await redis.ttl(key);
    // -2 is "no such key", -1 is "exists, never expires".
    if (current === -2) return "missing";
    if (current === -1) return "already-longer";
    if (current >= seconds - REFRESH_SLACK_SECONDS) return "already-longer";
    await redis.expire(key, Math.floor(seconds));
    return "extended";
  } catch {
    return "failed";
  }
}

/** Tops a finished trip's lifetime back up when someone opens it.
 *
 * The sliding half of keeping a trip. The base lifetime on the record
 * answers "how long is this kept without being looked at"; this answers
 * "a trip somebody is still using must not expire underneath them" - which
 * is a different question, and the one that bites on a trip opened during
 * the holiday it describes, thirteen months after it was planned.
 *
 * Only a FINISHED job. A pending or running one is polled every 400ms, and
 * refreshing on each of those would be a hundred and fifty pointless
 * commands per generation for a record whose whole lifetime is ahead of
 * it anyway. */
export async function touchJobTtl(redis: TtlRedis, job: Job): Promise<void> {
  if (job.status !== "done") return;
  await extendTtl(redis, jobKey(job.id), ttlForJob(job));
}
