// A shared trip link that follows the owner's changes.
//
// A push back or a hand edit makes a NEW trip with its own id (see
// app/api/refine and app/api/trip-edit), so a link sent to a friend before
// the change kept showing the old plan and had to be sent again. Each
// revision now leaves a pointer on the trip it replaces, and opening the
// old link goes to the newest finished version.
//
// Only the owner's own revisions move the link. The pointer is written
// when the same signed-in account made both the trip and its revision -
// the rule My trips and the day-ahead email already use - so a friend who
// pushes back on a shared trip gets their own version without changing
// what everyone else's link shows. A trip made signed out has no owner to
// compare, so its link stays where it is.
//
// Run: npm run test:latest-revision

import type { Redis } from "@upstash/redis";
import { jobKey, readJobRecord, type Job } from "./jobs";

/** Where a trip's pointer to its next version lives. */
export function nextKey(id: string): string {
  return `job:${id}:next`;
}

function sameOwner(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Records `to` as the next version of `from`, when the same account made
 * both. Kept as long as the new version is. */
export async function recordRevision(
  redis: Pick<Redis, "set">,
  from: { id: string; ownerEmail?: string },
  to: { id: string; ownerEmail?: string; ttlSeconds: number }
): Promise<boolean> {
  if (!sameOwner(from.ownerEmail, to.ownerEmail)) return false;
  await redis.set(nextKey(from.id), to.id, { ex: to.ttlSeconds });
  return true;
}

/** Revisions followed at most: a trip pushed back on more often than this
 * still resolves, just to its 20th version. */
const MAX_HOPS = 20;

/** The newest finished version of `id` by the same owner, or `id` itself.
 * A revision still being generated, or one that failed, is not followed:
 * the link shows the last version that actually exists. */
export async function latestRevision(redis: Pick<Redis, "get">, id: string): Promise<string> {
  const start = readJobRecord(await redis.get<string | Job>(jobKey(id)));
  if (!start?.ownerEmail) return id;
  let current = id;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = await redis.get<string>(nextKey(current));
    if (typeof next !== "string" || !next || next === current) break;
    const job = readJobRecord(await redis.get<string | Job>(jobKey(next)));
    if (!job || job.status !== "done" || !sameOwner(job.ownerEmail, start.ownerEmail)) break;
    current = next;
  }
  return current;
}
