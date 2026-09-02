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

export function getRecentTrips(): RecentTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
