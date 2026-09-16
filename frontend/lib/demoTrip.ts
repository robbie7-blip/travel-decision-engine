// The "see a real example" homepage demo - a real /trip/[jobId] link, set
// via /admin/demo-trip (protected by the same ADMIN_PASSWORD as the rest of
// /admin/*), not a fabricated example. This app's whole pitch is "grounded,
// not fabricated," so a fake demo would undermine the one claim it exists
// to prove - if no real trip has been set as the demo yet, the homepage
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

/** The stored demo, or null.
 *
 * Both readers did `typeof raw === "string" ? JSON.parse(raw) as DemoTrip :
 * raw`, with the parse outside any try. A truncated or older-format value
 * therefore 500'd /api/demo-trip - a route the HOMEPAGE calls - where this
 * file's entire argument is that a demo which cannot be shown should not be
 * shown: "if no real trip has been set as the demo yet, the homepage simply
 * doesn't show the link rather than making one up or showing a dead one." A
 * 500 is a third thing, and it is the one the design rules out.
 *
 * `destinations` is checked because it is rendered as the link's own label.
 * Same reader shape as readShowcaseTrip, for the same reasons - these two
 * are the same feature in the singular and the plural. */
export function readDemoTrip(value: unknown): DemoTrip | null {
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
  if (destinations.length === 0) return null;
  return {
    jobId: t.jobId,
    destinations,
    setAt: typeof t.setAt === "number" && Number.isFinite(t.setAt) ? t.setAt : 0,
  };
}
