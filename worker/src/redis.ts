// Standard TCP Redis client (ioredis), not the Upstash REST client the
// Next.js app uses. This process is long-running (unlike a Vercel
// serverless function), so it can hold one persistent connection open and
// block on it with BRPOP — the REST API can't do blocking reads at all.

import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set — point it at the Upstash Redis TCP endpoint.");
  }

  client = new Redis(url, {
    maxRetriesPerRequest: null, // required for blocking commands (BRPOP) with ioredis
  });
  return client;
}
