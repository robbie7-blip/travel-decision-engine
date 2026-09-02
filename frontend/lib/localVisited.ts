// Client-side, device-local storage for the visited-countries tracker - the
// primary store now (see app/account/visited/page.tsx). Modeled on how the
// Been app works: marking a country visited needs no account at all, it
// just needs to persist on this device. Signing in is an optional upgrade
// (see lib/visited.ts + app/api/visited) for syncing that same list across
// devices, not a requirement to use the feature in the first place.

export interface VisitedPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  note?: string;
}

export interface VisitedEntry {
  code: string;
  visitedAt?: string; // ISO date, e.g. "2024-07-03" - optional
  pins?: VisitedPin[];
}

const ENTRIES_KEY = "decide:visited-entries";
// Pre-dates/pins format: a bare array of ISO codes. Still read (and
// migrated) below so nobody who used the tracker before this format
// changed loses their list.
const LEGACY_CODES_KEY = "decide:visited-codes";
const SHARE_TOKEN_KEY = "decide:visited-share-token";

function isValidEntry(value: unknown): value is VisitedEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

export function readLocalVisitedEntries(): VisitedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ENTRIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValidEntry);
      return [];
    }
    const legacy = window.localStorage.getItem(LEGACY_CODES_KEY);
    if (legacy) {
      const codes = JSON.parse(legacy);
      if (Array.isArray(codes)) {
        const migrated: VisitedEntry[] = codes
          .filter((c): c is string => typeof c === "string")
          .map((code) => ({ code }));
        writeLocalVisitedEntries(migrated);
        return migrated;
      }
    }
  } catch {
    // Corrupt or inaccessible storage - treat as empty rather than crash the page.
  }
  return [];
}

export function writeLocalVisitedEntries(entries: VisitedEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
  } catch {
    // Storage can fail (private browsing, quota) - the in-memory state
    // still reflects the change for this render, it just won't persist.
  }
}

/** Reads the share token for this device WITHOUT creating one - used to
 * decide whether a previously-shared anonymous link needs refreshing after
 * a toggle. Returns null if this device has never generated a share link. */
export function peekLocalShareToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SHARE_TOKEN_KEY);
}

/** Reads this device's share token, minting one on first use. The token
 * itself (not an email) is the whole identity behind an anonymous share
 * link - see lib/statsShare.ts's anonymous snapshot functions. */
export function getOrCreateLocalShareToken(): string {
  if (typeof window === "undefined") return "";
  let token = window.localStorage.getItem(SHARE_TOKEN_KEY);
  if (!token) {
    token = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "");
    window.localStorage.setItem(SHARE_TOKEN_KEY, token);
  }
  return token;
}
