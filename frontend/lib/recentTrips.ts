// Purely client-side "recent trips" bookmark list - no accounts, no server
// state. Backed by the durable /trip/[jobId] links the app already returns
// (JOB_TTL_SECONDS keeps a job's record alive 30 days - see lib/jobs.ts),
// this just remembers which ones a particular browser has visited so a
// returning visitor can find their way back without hunting for the link.
// Per-browser by design: clearing site data or switching devices loses the
// list, same tradeoff as the existing LANGUAGE_STORAGE_KEY preference.

import type { Language } from "./types";

const STORAGE_KEY = "decide:recentTrips";
const MAX_ENTRIES = 8;

export interface RecentTrip {
  jobId: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  language: Language;
  savedAt: number;
}

/** Whether a stored entry is actually shaped like one.
 *
 * `Array.isArray(parsed) ? parsed : []` checked the container and nothing
 * inside it, and RecentTrips.tsx then renders
 * `trip.destinations.join(" · ")` - so a single entry without that field
 * throws a TypeError DURING RENDER, and the component sits in the homepage
 * hero. The visitor gets a blank hero with no way to know why, and it
 * persists until they clear site data, because the bad entry is read again
 * on every load.
 *
 * That is the same shape as the exchange-rate bug: data from a store that
 * outlives deploys, rendered without being checked. And it is reachable
 * without anyone editing anything by hand - this interface is versioned by
 * nothing, so the day a field is added or renamed, every returning
 * visitor's existing entries are the old shape.
 *
 * Checked rather than repaired: a half-entry has no trip behind it worth
 * showing, and dropping it silently is exactly what the list already does
 * for a parse failure. */
function isRecentTrip(value: unknown): value is RecentTrip {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<RecentTrip>;
  return (
    typeof t.jobId === "string" &&
    t.jobId.length > 0 &&
    Array.isArray(t.destinations) &&
    t.destinations.every((d) => typeof d === "string") &&
    typeof t.startDate === "string" &&
    typeof t.endDate === "string"
  );
}

export function getRecentTrips(): RecentTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Capped on read as well as on write. The write path enforces
    // MAX_ENTRIES, but a value that got there another way (an older build, a
    // hand edit) is not bound by it, and this list renders in the hero.
    return parsed.filter(isRecentTrip).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Upserts by jobId (moves it to the front if already present), caps the
 * list at MAX_ENTRIES, dropping the oldest. Best-effort: a localStorage
 * write failure (private browsing, quota) must never break the actual
 * generation flow, so this never throws. */
export function saveRecentTrip(entry: Omit<RecentTrip, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentTrips().filter((trip) => trip.jobId !== entry.jobId);
    const next = [{ ...entry, savedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore - see rationale above
  }
}

export function removeRecentTrip(jobId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = getRecentTrips().filter((trip) => trip.jobId !== jobId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore - see rationale above
  }
}
