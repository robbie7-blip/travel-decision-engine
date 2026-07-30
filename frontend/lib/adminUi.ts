// Marks this browser as having successfully passed Basic Auth against an
// /admin/* page at some point (see middleware.ts) — set by those pages
// themselves on load, since reaching them at all already proves it. Lets
// AddToShowcaseButton decide whether to show its control on a public
// /trip/[jobId] page WITHOUT ever probing a Basic-Auth-protected endpoint
// from that page: some browsers (Safari included) pop the native
// username/password dialog for a background fetch() against a 401-
// challenging URL, not just for a top-level navigation, so probing
// /api/admin/showcase from every visitor's trip page prompted every
// visitor for a password. A plain localStorage flag never talks to a
// protected endpoint, so it can never trigger that dialog.
export const ADMIN_UI_FLAG_KEY = "decide:admin-ui";

export function markAdminUi(): void {
  window.localStorage.setItem(ADMIN_UI_FLAG_KEY, "1");
}

export function isAdminUi(): boolean {
  return window.localStorage.getItem(ADMIN_UI_FLAG_KEY) === "1";
}
