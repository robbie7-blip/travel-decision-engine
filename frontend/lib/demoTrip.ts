// The "see a real example" homepage demo — a real /trip/[jobId] link, set
// via /admin/demo-trip (protected by the same ADMIN_PASSWORD as the rest of
// /admin/*), not a fabricated example. This app's whole pitch is "grounded,
// not fabricated," so a fake demo would undermine the one claim it exists
// to prove — if no real trip has been set as the demo yet, the homepage
// simply doesn't show the link rather than making one up or showing a dead
// one. Setting a trip as the demo also extends its own job record's TTL
// (see CURATED_JOB_TTL_SECONDS in lib/jobs.ts) well past the normal 30
// days, so the demo doesn't silently break a month after being set.

export const DEMO_TRIP_KEY = "demo:trip:current";

export interface DemoTrip {
  jobId: string;
  destinations: string[];
  setAt: number;
}
