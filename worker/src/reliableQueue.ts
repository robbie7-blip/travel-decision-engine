// Taking jobs off the queue without ever losing one.
//
// BRPOP removes a job from the queue the moment a worker takes it, so a
// worker that died mid-generation - a deploy, a crash, running out of
// memory - took the job with it: its record said "running" until the page
// called it stalled four minutes later. Here a job is MOVED, atomically,
// into this worker's own processing list (BLMOVE) and only removed from it
// once its final record is written. Each worker keeps a short-lived
// "alive" key; any other worker that finds a registered worker with no
// alive key puts that worker's unfinished jobs back on the queue.
//
// A shutdown is a worker that stops: it finishes what it can, closes its
// queue connections, and only then deletes its alive key - so the next
// sweep by another worker recovers whatever is left, and nothing is put
// back while the process that owned it could still write to it.
//
// Run: npm run test:reliable-queue (needs a LOCAL REDIS_URL; CI has one)

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import { JOBS_QUEUE_KEY } from "./jobs";

export const WORKERS_KEY = "workers:active";
export const processingKey = (worker: string) => `jobs:processing:${worker}`;
export const aliveKey = (worker: string) => `worker:alive:${worker}`;

/** How long a worker counts as alive after its last refresh, and how
 * often it refreshes and sweeps. A worker that crashes is recovered
 * within ALIVE_TTL_SECONDS + SWEEP_MS - about 80 seconds, well inside the
 * four minutes after which the page calls a trip stalled. Kept this slow
 * on purpose: Upstash bills per command, and every worker pays for these
 * around the clock. */
export const ALIVE_TTL_SECONDS = 60;
export const ALIVE_REFRESH_MS = 20_000;
export const SWEEP_MS = 20_000;

export function newWorkerId(): string {
  return `${hostname().slice(0, 40)}-${process.pid}-${randomBytes(3).toString("hex")}`;
}

/** Alive and registered, in one step - so a sweep can never see this
 * worker registered but not yet alive and declare it dead. Also the
 * refresh: a worker some sweep wrongly took for dead (a long Redis outage)
 * rejoins the registry the next time it refreshes. */
export async function markAlive(redis: Redis, worker: string): Promise<void> {
  await redis.multi().set(aliveKey(worker), String(Date.now()), "EX", ALIVE_TTL_SECONDS).sadd(WORKERS_KEY, worker).exec();
}

/** The next job, moved into this worker's processing list in the same
 * step it leaves the queue. Blocks until one arrives (`timeoutSeconds` 0)
 * or the connection is closed. `conn` must allow blocking
 * (maxRetriesPerRequest: null). */
export async function takeJob(conn: Redis, worker: string, timeoutSeconds = 0): Promise<string | null> {
  return conn.blmove(JOBS_QUEUE_KEY, processingKey(worker), "RIGHT", "LEFT", timeoutSeconds);
}

/** The job's final record is written: it is no longer this worker's to
 * finish. */
export async function finishJob(redis: Redis, worker: string, id: string): Promise<void> {
  await redis.lrem(processingKey(worker), 1, id);
}

/** Straight back to the FRONT of the queue (BLMOVE takes from the right),
 * in one step, for a job taken but not started. */
export async function returnJob(redis: Redis, worker: string, id: string): Promise<void> {
  await redis.multi().lrem(processingKey(worker), 1, id).rpush(JOBS_QUEUE_KEY, id).exec();
}

/** One sweep, in one atomic step inside Redis: for every registered worker
 * other than this one whose alive key is gone, its unfinished jobs go back
 * to the front of the queue (oldest first), finished ones are dropped, and
 * it leaves the registry.
 *
 * Atomic so nothing can happen in between: no BLMOVE can land a job in
 * the list after it was read and before it was deleted, no second sweeper
 * can put the same jobs back, and a job whose "done" record lands at the
 * same moment stays done - either this sees "done", or the worker that
 * picks it up reads "done" and skips it.
 *
 * Job records are only read, never rewritten: Redis's Lua JSON encoder
 * turns an empty list into an empty object, which would quietly corrupt a
 * brief. The worker that picks a recovered job up resets its progress
 * itself. A record written through the website's REST client can be a
 * JSON string holding the JSON (see readJobRecord), hence the second
 * decode. Returns the ids put back. */
const SWEEP_SCRIPT = `
local recovered = {}
for _, worker in ipairs(redis.call("SMEMBERS", KEYS[1])) do
  if worker ~= ARGV[1] and redis.call("EXISTS", "worker:alive:" .. worker) == 0 then
    local list = "jobs:processing:" .. worker
    for _, id in ipairs(redis.call("LRANGE", list, 0, -1)) do
      local raw = redis.call("GET", "job:" .. id)
      local unfinished = false
      if raw then
        local ok, job = pcall(cjson.decode, raw)
        if ok and type(job) == "string" then ok, job = pcall(cjson.decode, job) end
        if ok and type(job) == "table" and (job.status == "running" or job.status == "pending") then
          unfinished = true
        end
      end
      if unfinished then
        redis.call("RPUSH", KEYS[2], id)
        table.insert(recovered, id)
      end
    end
    redis.call("DEL", list)
    redis.call("SREM", KEYS[1], worker)
  end
end
return recovered
`;

/** See SWEEP_SCRIPT. The processing list is newest-first (BLMOVE pushes
 * on the left), and each RPUSH lands at the front of the queue, so the
 * oldest ends up first in line. */
export async function recoverDeadWorkers(redis: Redis, self: string): Promise<string[]> {
  return (await redis.eval(SWEEP_SCRIPT, 2, WORKERS_KEY, JOBS_QUEUE_KEY, self)) as string[];
}
