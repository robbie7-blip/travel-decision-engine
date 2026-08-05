// Owner-only "test mode" flag — same localStorage-flag pattern as
// lib/adminUi.ts, and deliberately holds the actual ADMIN_PASSWORD value
// (not just a boolean), since /api/generate needs to see it on every
// request to verify this browser is actually the owner, not just "some
// browser that once visited /admin". Set from app/admin/test-mode (already
// Basic-Auth-protected by middleware.ts), read by lib/api.ts when creating
// a generation job.
//
// Security note: this is the same proportional, single-owner-tool posture
// middleware.ts already documents for ADMIN_PASSWORD itself — storing it in
// this browser's localStorage to auto-attach as a header is no weaker than
// the browser already having typed it into a Basic Auth prompt to reach
// this page in the first place.
const TEST_MODE_KEY_STORAGE = "decide:test-mode-key";
export const TEST_MODE_HEADER = "x-decide-test-mode";

export function getTestModeKey(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(TEST_MODE_KEY_STORAGE);
  return value && value.length > 0 ? value : null;
}

export function setTestModeKey(key: string | null): void {
  if (!key) {
    window.localStorage.removeItem(TEST_MODE_KEY_STORAGE);
  } else {
    window.localStorage.setItem(TEST_MODE_KEY_STORAGE, key);
  }
}
