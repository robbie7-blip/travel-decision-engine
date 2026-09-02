// Standard TCP Redis client (ioredis), not the Upstash REST client the
// Next.js app uses. This process is long-running (unlike a Vercel
// serverless function), so it can hold one persistent connection open and
// block on it with BRPOP - the REST API can't do blocking reads at all.

import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set - point it at the Upstash Redis TCP endpoint.");
  }

  // maxRetriesPerRequest is NOT null here, deliberately.
  //
  // ioredis needs null for blocking commands, and this client was created
  // with it because runConsumer's BRPOP runs on a duplicate of it. But null
  // means "retry this command forever", and this same connection also
  // serves every ordinary get and set in a job. A brief Redis blip
  // therefore didn't fail a command, it hung it indefinitely - a generation
  // that stops dead partway through and never finishes or errors, which
  // from the outside is indistinguishable from the pipeline being slow.
  //
  // The blocking connection overrides this back to null where it's actually
  // required (see runConsumer), so BRPOP still behaves correctly and normal
  // commands get a bounded failure instead of an unbounded wait.
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
  });
  return client;
}
