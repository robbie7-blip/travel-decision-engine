// Client-side, device-local storage for the visited-countries tracker — the
// primary store now (see app/account/visited/page.tsx). Modeled on how the
// Been app works: marking a country visited needs no account at all, it
// just needs to persist on this device. Signing in is an optional upgrade
// (see lib/visited.ts + app/api/visited) for syncing that same list across
// devices, not a requirement to use the feature in the first place.

const CODES_KEY = "decide:visited-codes";
const SHARE_TOKEN_KEY = "decide:visited-share-token";

export function readLocalVisitedCodes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CODES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    // Corrupt or inaccessible storage — treat as empty rather than crash the page.
    return [];
  }
}

export function writeLocalVisitedCodes(codes: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODES_KEY, JSON.stringify(codes));
  } catch {
    // Storage can fail (private browsing, quota) — the in-memory state
    // still reflects the toggle for this render, it just won't persist.
  }
}

/** Reads the share token for this device WITHOUT creating one — used to
 * decide whether a previously-shared anonymous link needs refreshing after
 * a toggle. Returns null if this device has never generated a share link. */
export function peekLocalShareToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SHARE_TOKEN_KEY);
}

/** Reads this device's share token, minting one on first use. The token
 * itself (not an email) is the whole identity behind an anonymous share
 * link — see lib/statsShare.ts's anonymous snapshot functions. */
export function getOrCreateLocalShareToken(): string {
  if (typeof window === "undefined") return "";
  let token = window.localStorage.getItem(SHARE_TOKEN_KEY);
  if (!token) {
    token = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "");
    window.localStorage.setItem(SHARE_TOKEN_KEY, token);
  }
  return token;
}
