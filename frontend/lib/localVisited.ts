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
    token = mintShareToken();
    if (!token) return "";
    window.localStorage.setItem(SHARE_TOKEN_KEY, token);
  }
  return token;
}

/** 32 hex characters of real randomness, or "" if this browser cannot
 * produce any.
 *
 * This used to be `crypto.randomUUID?.() ?? \`${Date.now()}-${Math.random()}\``,
 * which has two problems.
 *
 * The fallback was GUESSABLE, and this token is the entire identity behind
 * an anonymous share link - "the token IS the access control", as
 * app/api/stats-share/[token] puts it. Date.now() is knowable to the
 * millisecond and Math.random() is not a cryptographic generator, so a
 * token minted that way is a few million guesses from being found, not
 * 2^128.
 *
 * And the fallback was reachable: crypto.randomUUID is available only in a
 * SECURE CONTEXT, so any plain-http origin (a phone on the local network
 * pointed at a dev server, a misconfigured deploy) took it, as did Safari
 * before 15.4 and Firefox before 95. Nobody noticed, partly because the
 * fallback's output still contains the "." from Math.random() after the
 * hyphen strip - a shape no legitimate token has.
 *
 * getRandomValues is the right primitive here: it is a real CSPRNG, it is
 * NOT gated on a secure context, and it predates randomUUID in every engine
 * that has either. The optional chain is on `crypto` itself as well as the
 * method - `crypto.randomUUID?.()` still throws a ReferenceError where
 * `crypto` is undefined, which is the same misplaced-optional-chain mistake
 * that `rates?.rates[currency]` made in currency.ts.
 *
 * Returning "" rather than a weak token is deliberate. The caller already
 * handles "" (it is what the server-side branch above returns), and
 * app/api/visited/share now rejects a token this short - so the worst case
 * is a share button that does not produce a link, instead of one that
 * produces a link someone else can find. */
function mintShareToken(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (!c?.getRandomValues) return "";
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
