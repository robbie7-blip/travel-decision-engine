// The homepage bar remembers the last trip asked for, on this device.
//
// Someone who comes back - to try other dates, or because the first tab
// was closed - finds the bar as they left it rather than empty. Stored in
// localStorage only, beside the recent-trips list that already keeps the
// same cities and dates on the same device (lib/recentTrips.ts); nothing
// here is sent anywhere.
//
// Only the four things the bar asks. Budget, diet, mobility and the rest
// are deliberately NOT kept: they are the more personal answers, and a
// shared family laptop should not offer them to the next person.
//
// Run: npm run test:last-search

export const LAST_SEARCH_KEY = "decide:last-search";

export interface LastSearch {
  destinations: string;
  start_date: string;
  end_date: string;
  party_size: string;
  party_composition: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function serializeLastSearch(search: LastSearch): string {
  return JSON.stringify({
    destinations: search.destinations,
    start_date: search.start_date,
    end_date: search.end_date,
    party_size: search.party_size,
    party_composition: search.party_composition,
  });
}

/** What to put back in the bar, or null. `today` is YYYY-MM-DD.
 *
 * Dates that have started are dropped rather than restored: a trip whose
 * first day is behind us cannot be planned, and filling it in would only
 * produce a 400 on the next press. The cities and the party are still
 * worth keeping. */
export function restoreLastSearch(raw: string | null, today: string): Partial<LastSearch> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof v[key] === "string" && (v[key] as string).length <= max ? (v[key] as string) : "";

  const destinations = text("destinations", 500).trim();
  if (!destinations) return null;

  const out: Partial<LastSearch> = { destinations };
  const start = text("start_date", 10);
  const end = text("end_date", 10);
  if (ISO_DATE.test(start) && ISO_DATE.test(end) && start >= today && end >= start) {
    out.start_date = start;
    out.end_date = end;
  }
  const size = text("party_size", 3);
  const composition = text("party_composition", 200).trim();
  if (/^\d{1,2}$/.test(size) && Number(size) >= 1 && composition) {
    out.party_size = size;
    out.party_composition = composition;
  }
  return out;
}
