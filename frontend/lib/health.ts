// What /admin/health checks, and how much each thing matters.
//
// This exists because "decide" is two deployments that share nothing but a
// Redis queue: a Next.js app on Vercel and a long-running worker on
// Railway. Each has its own environment, and neither can read the other's.
// Every configuration failure this product has actually had has been the
// same shape - a key was set on one side and not the other, the code
// degraded quietly instead of crashing, and nobody found out until a
// traveler saw the result.
//
// So the point of this list is not "is the app up". It is: which of the
// things that fail SILENTLY are currently failing.
//
// Presence only, never values. Nothing here reads a character of a secret,
// and nothing downstream is capable of printing one.

import type { WorkerHeartbeat } from "./jobs";

/** How much it matters when this one is missing.
 *
 * The middle case is the one worth having. A required variable throws on
 * first use and announces itself. An optional one is a deliberate choice
 * not to run a feature. "degrades" is the dangerous middle: the code
 * carefully carries on without it, which is correct behaviour and also
 * exactly why nobody notices for weeks. */
export type Criticality = "required" | "degrades" | "optional";

export interface EnvCheck {
  name: string;
  criticality: Criticality;
  /** What stops working, in the words of someone using the product. */
  what: string;
}

/** Set on the Vercel deployment. */
export const FRONTEND_ENV: readonly EnvCheck[] = [
  {
    name: "UPSTASH_REDIS_REST_URL",
    criticality: "required",
    what: "Queuing a trip at all",
  },
  {
    name: "UPSTASH_REDIS_REST_TOKEN",
    criticality: "required",
    what: "Queuing a trip at all",
  },
  {
    name: "ANTHROPIC_API_KEY",
    criticality: "required",
    what: "Ask a Local, trip questions, pasted-booking import",
  },
  {
    name: "ANTHROPIC_WORKSPACE_ID",
    criticality: "degrades",
    what: "Only needed if the key is identity-linked; without it every model call 400s",
  },
  {
    name: "GOOGLE_PLACES_API_KEY",
    criticality: "degrades",
    what: "Venue and day photos (the app renders without them and says nothing)",
  },
  {
    name: "SESSION_SECRET",
    criticality: "required",
    what: "Signing in, saved trips, subscriptions",
  },
  {
    name: "RESEND_API_KEY",
    criticality: "required",
    what: "Sending the sign-in link",
  },
  {
    name: "EMAIL_FROM",
    criticality: "required",
    what: "Sending the sign-in link",
  },
  {
    name: "STRIPE_SECRET_KEY",
    criticality: "degrades",
    what: "Upgrading to paid",
  },
  {
    name: "STRIPE_PRICE_ID",
    criticality: "degrades",
    what: "Upgrading to paid",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    criticality: "degrades",
    what: "Recording a completed payment (an upgrade would be charged and not applied)",
  },
];

/** Set on the Railway worker. Read from its heartbeat, not from here - this
 * process genuinely cannot see that environment, which is the whole reason
 * the heartbeat carries the names. */
export const WORKER_ENV: readonly EnvCheck[] = [
  {
    name: "ANTHROPIC_API_KEY",
    criticality: "required",
    what: "Generating an itinerary",
  },
  {
    name: "ANTHROPIC_WORKSPACE_ID",
    criticality: "degrades",
    what: "Only needed if the key is identity-linked; without it every generation fails",
  },
  {
    name: "REDIS_URL",
    criticality: "required",
    what: "Taking jobs off the queue",
  },
  {
    name: "GOOGLE_PLACES_API_KEY",
    criticality: "degrades",
    what: "Verifying venues exist, and their hours, ratings and photos",
  },
  {
    name: "AMADEUS_API_KEY",
    criticality: "optional",
    what: "Real flight prices instead of estimates",
  },
  {
    name: "AMADEUS_API_SECRET",
    criticality: "optional",
    what: "Real flight prices instead of estimates",
  },
  {
    name: "BUDGET_ALERT_WEBHOOK_URL",
    criticality: "optional",
    what: "Pushing a spend alert somewhere other than the logs",
  },
];

export interface CheckedEnv extends EnvCheck {
  present: boolean;
}

export type Verdict = "ok" | "warn" | "down";

/** A missing variable is only as bad as what it takes down with it. */
export function verdictFor(check: CheckedEnv): Verdict {
  if (check.present) return "ok";
  if (check.criticality === "required") return "down";
  if (check.criticality === "degrades") return "warn";
  return "ok";
}

/** The worst verdict in a set, which is the one that belongs at the top. */
export function worstOf(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("down")) return "down";
  if (verdicts.includes("warn")) return "warn";
  return "ok";
}

/** Reads this deployment's own environment. Server only.
 *
 * Indexed access rather than `process.env.NAME` per variable: the value is
 * never wanted, only whether something is there, and Boolean() means an
 * empty string counts as absent - which it is, since every consumer here
 * treats "" as unset. */
export function checkFrontendEnv(): CheckedEnv[] {
  return FRONTEND_ENV.map((check) => ({ ...check, present: Boolean(process.env[check.name]) }));
}

export function checkWorkerEnv(heartbeat: WorkerHeartbeat): CheckedEnv[] {
  const present = new Set(heartbeat.envPresent);
  return WORKER_ENV.map((check) => ({ ...check, present: present.has(check.name) }));
}

/** True when this value actually looks like a heartbeat.
 *
 * Anything in Redis under that key could be a value from an older worker
 * build, a half-written write, or something else entirely. Trusting the
 * shape gets you "NaNs ago" printed under a card that still says OK, which
 * is the page lying with confidence. /api/health makes the same check
 * before it answers 200. */
export function isWorkerHeartbeat(value: unknown): value is WorkerHeartbeat {
  const beat = value as WorkerHeartbeat | null;
  return (
    typeof beat?.updatedAt === "string" && Number.isFinite(Date.parse(beat.updatedAt))
  );
}

/** How stale the heartbeat is, in seconds, or null if it does not carry a
 * readable timestamp. Negative clamped to 0: clock skew between two hosts
 * is normal and "in 3 seconds" reads as a bug. */
export function heartbeatAgeSeconds(heartbeat: WorkerHeartbeat, now = Date.now()): number | null {
  if (!isWorkerHeartbeat(heartbeat)) return null;
  return Math.max(0, Math.round((now - Date.parse(heartbeat.updatedAt)) / 1000));
}

/** Human duration for the two ages this page shows. Deliberately coarse -
 * nobody reading this needs "4h 12m 6s". */
export function describeAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
