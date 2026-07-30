// The "see a real example" homepage demo — a real /trip/[jobId] link, set
// via /admin/demo-trip (protected by the same ADMIN_PASSWORD as the rest of
// /admin/*), not a fabricated example. This app's whole pitch is "grounded,
// not fabricated," so a fake demo would undermine the one claim it exists
// to prove — if no real trip has been set as the demo yet (or the one that
// was set has since expired past JOB_TTL_SECONDS), the homepage simply
// doesn't show the link rather than making one up or showing a dead one.

export const DEMO_TRIP_KEY = "demo:trip:current";

export interface DemoTrip {
  jobId: string;
  destinations: string[];
  setAt: number;
}
