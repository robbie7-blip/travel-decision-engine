// Shared job envelope + Redis key conventions for the async generation
// pipeline. Imported by both the Next.js app (writes jobs via the Upstash
// REST client, reads status for polling) and the worker (consumes jobs via
// a standard TCP Redis client, writes results). Deliberately has no
// Next.js-specific imports so it's portable to the worker like the rest of
// lib/engine/.

import type { Itinerary, TripBriefInput } from "./types";

export type JobStatus = "pending" | "running" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  brief: TripBriefInput;
  result?: Itinerary;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export const JOBS_QUEUE_KEY = "jobs:queue";
export const JOB_TTL_SECONDS = 60 * 60; // 1 hour — plenty for a user to poll to completion

export function jobKey(id: string): string {
  return `job:${id}`;
}
