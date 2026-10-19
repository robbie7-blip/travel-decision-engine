// The reliable queue against a real Redis: a job taken by a worker that
// dies is put back, a finished one is not, and nothing is lost on the way.
//
// Needs REDIS_URL pointing at a throwaway LOCAL Redis (CI provides one).
// It empties the database it is given, so it refuses anything that is not
// on this machine - a REDIS_URL left pointing at the real Upstash for
// running the worker must never be wiped by `npm test`.
//
// Run: REDIS_URL=redis://... npm run test:reliable-queue

import Redis from "ioredis";
import { JOBS_QUEUE_KEY, jobKey } from "./jobs";
import {
  WORKERS_KEY,
  aliveKey,
  finishJob,
  processingKey,
  recoverDeadWorkers,
  markAlive,
  returnJob,
  takeJob,
} from "./reliableQueue";
import { check, finish, heading, section } from "./testutil";

heading("reliable queue");

async function main() {
  const url = process.env.REDIS_URL;
  let local = false;
  try {
    local = ["localhost", "127.0.0.1", "::1"].includes(new URL(url ?? "").hostname);
  } catch {
    local = false;
  }
  if (!url || !local) {
    if (process.env.CI) check("REDIS_URL points at a local Redis for this suite", false, "CI must provide one");
    else console.log(`\n  SKIPPED  ${url ? "REDIS_URL is not a local Redis - this suite empties it" : "no REDIS_URL"} (CI runs it)\n`);
    finish();
    return;
  }
  const redis = new Redis(url, { maxRetriesPerRequest: 3 });
  const blocking = new Redis(url, { maxRetriesPerRequest: null });
  await redis.flushdb();
  const job = (id: string, status: string) => JSON.stringify({ id, status, brief: { destinations: [], interests: [] }, createdAt: 1, updatedAt: 1 });

  section("taking and finishing");
  await markAlive(redis, "a");
  await redis.lpush(JOBS_QUEUE_KEY, "j1", "j2"); // queue: [j2, j1], j1 at the front (right)
  check("the oldest job is taken first", (await takeJob(blocking, "a", 1)) === "j1");
  check("and moved, not removed: it is in the worker's list", JSON.stringify(await redis.lrange(processingKey("a"), 0, -1)) === '["j1"]');
  check("and no longer in the queue", JSON.stringify(await redis.lrange(JOBS_QUEUE_KEY, 0, -1)) === '["j2"]');
  await finishJob(redis, "a", "j1");
  check("finished: out of the worker's list", (await redis.llen(processingKey("a"))) === 0);
  check("then the next", (await takeJob(blocking, "a", 1)) === "j2");
  check("an empty queue waits, then gives nothing", (await takeJob(blocking, "a", 1)) === null);

  section("a job taken during shutdown goes straight back to the front");
  await redis.lpush(JOBS_QUEUE_KEY, "j3");
  await returnJob(redis, "a", "j2");
  check("it is next in line again", (await redis.lindex(JOBS_QUEUE_KEY, -1)) === "j2");
  check("and out of the worker's list", (await redis.llen(processingKey("a"))) === 0);

  section("a worker that stops");
  await redis.flushdb();
  await markAlive(redis, "dead");
  await markAlive(redis, "live");
  await redis.set(jobKey("run1"), job("run1", "running"));
  await redis.set(jobKey("run2"), job("run2", "running"));
  // The website's REST client can store the JSON as a JSON string.
  await redis.set(jobKey("wrapped"), JSON.stringify(job("wrapped", "running")));
  await redis.set(jobKey("done1"), job("done1", "done"));
  await redis.set(jobKey("err1"), job("err1", "error"));
  await redis.lpush(JOBS_QUEUE_KEY, "run1", "run2", "wrapped", "done1", "err1", "queued");
  for (let i = 0; i < 5; i++) await takeJob(blocking, "dead", 1);
  check("the dead worker held five", (await redis.llen(processingKey("dead"))) === 5);
  check("nothing is recovered while it is alive", (await recoverDeadWorkers(redis, "live")).length === 0);
  await redis.del(aliveKey("dead"));
  const back = await recoverDeadWorkers(redis, "live");
  check("its unfinished jobs are recovered, double-encoded one included", JSON.stringify([...back].sort()) === '["run1","run2","wrapped"]', JSON.stringify(back));
  const queue = await redis.lrange(JOBS_QUEUE_KEY, 0, -1);
  check("finished and failed jobs are not put back", !queue.includes("done1") && !queue.includes("err1"), JSON.stringify(queue));
  check("recovered jobs run before ones queued after them, oldest first", queue.slice(-3).reverse().join(",") === "run1,run2,wrapped" && queue[0] === "queued", JSON.stringify(queue));
  check("its list is gone and it left the registry", (await redis.exists(processingKey("dead"))) === 0 && !(await redis.smembers(WORKERS_KEY)).includes("dead"));
  check("a second sweep finds nothing", (await recoverDeadWorkers(redis, "live")).length === 0);
  const raw = await redis.get(jobKey("run1"));
  check("records are left exactly as they were", raw === job("run1", "running"));

  section("a worker wrongly taken for dead comes back");
  await markAlive(redis, "slow");
  await redis.del(aliveKey("slow"));
  await recoverDeadWorkers(redis, "live");
  check("it was taken off the registry", !(await redis.smembers(WORKERS_KEY)).includes("slow"));
  await markAlive(redis, "slow");
  check("and its next refresh puts it back", (await redis.smembers(WORKERS_KEY)).includes("slow") && (await redis.exists(aliveKey("slow"))) === 1);

  section("two workers sweeping at once");
  await markAlive(redis, "gone");
  await redis.set(jobKey("x"), job("x", "running"));
  await redis.lpush(JOBS_QUEUE_KEY, "x");
  await takeJob(blocking, "gone", 1);
  await redis.del(aliveKey("gone"));
  const [r1, r2] = await Promise.all([recoverDeadWorkers(redis, "live"), recoverDeadWorkers(redis, "other")]);
  check("the job is put back once, not twice", r1.length + r2.length === 1 && (await redis.lrange(JOBS_QUEUE_KEY, 0, -1)).filter((v) => v === "x").length === 1);

  await redis.flushdb();
  redis.disconnect();
  blocking.disconnect();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
