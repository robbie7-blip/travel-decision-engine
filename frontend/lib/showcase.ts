// A curated public gallery of real, already-generated trips (see
// /showcase), admin-managed via /admin/showcase (protected by the same
// ADMIN_PASSWORD as the rest of /admin/*). Same "grounded, not fabricated"
// reasoning as the single homepage demo trip (lib/demoTrip.ts) - just
// plural: a whole page of real examples rather than one inline link.

export const SHOWCASE_LIST_KEY = "showcase:trips";

// Caps how many entries /admin/showcase POST keeps - oldest are trimmed
// first - so the gallery stays curated rather than growing forever.
export const MAX_SHOWCASE_ENTRIES = 24;

export interface ShowcaseTrip {
  jobId: string;
  destinations: string[];
  addedAt: number;
}
