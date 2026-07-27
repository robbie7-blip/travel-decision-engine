// Upstash REST client — used only on the Next.js side (serverless-friendly,
// no persistent connection). The worker uses a standard TCP Redis client
// instead (see worker/src/redis.ts), since it's a long-running process that
// can hold one open connection and block on it (BRPOP).

import { Redis } from "@upstash/redis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set — the job queue is unconfigured."
    );
  }

  client = new Redis({ url, token });
  return client;
}
