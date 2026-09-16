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

/** One stored entry, or null.
 *
 * Both readers of this list did `raw.map((r) => typeof r === "string" ?
 * JSON.parse(r) as ShowcaseTrip : r)` - an unguarded parse inside a map,
 * followed by an unvalidated `as`. Measured, on the shapes a Redis list can
 * actually hold: ONE bad entry among good ones takes the whole public
 * gallery down, five different ways.
 *
 *   one truncated entry        -> THREW: Unexpected end of JSON input
 *   one non-JSON entry         -> THREW: Unexpected token 'o'
 *   destinations as a string   -> THREW: entry.destinations.join is not a function
 *   destinations missing       -> THREW: Cannot read properties of undefined
 *   entry is null              -> THREW: Cannot read properties of null
 *
 * The last three are the page's own `card.destinations.join(" · ")`, on a
 * field nothing checked. /showcase is public and unauthenticated, so that is
 * a 500 on a marketing page for as long as the entry sits in the list - and
 * the list is admin-written, meaning nobody would think to look at it.
 *
 * A bad entry now costs ITSELF and nothing else, which is the same trade
 * the page already makes for a job that has expired: "an expired job just
 * quietly drops off the gallery instead of showing a dead link." */
export function readShowcaseTrip(value: unknown): ShowcaseTrip | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const t = parsed as Record<string, unknown>;
  if (typeof t.jobId !== "string" || !t.jobId.trim()) return null;
  if (!Array.isArray(t.destinations)) return null;
  const destinations = t.destinations.filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  // A card with no destination has nothing to title it with, and the page
  // renders the list as the card's heading.
  if (destinations.length === 0) return null;
  return {
    jobId: t.jobId,
    destinations,
    // Only used for ordering, and the list's own order is what the page
    // actually reverses - so an unreadable one costs nothing and must not
    // cost the entry.
    addedAt: typeof t.addedAt === "number" && Number.isFinite(t.addedAt) ? t.addedAt : 0,
  };
}

/** Every readable entry in the stored list, in stored order. */
export function readShowcaseList(raw: readonly unknown[]): ShowcaseTrip[] {
  return raw.map(readShowcaseTrip).filter((t): t is ShowcaseTrip => t !== null);
}
