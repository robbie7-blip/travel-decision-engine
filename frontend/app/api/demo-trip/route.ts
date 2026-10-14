// Public, read-only: returns the current homepage demo trip, if one is set
// and its underlying job hasn't expired past JOB_TTL_SECONDS - never a
// fabricated example, see lib/demoTrip.ts. Separate from GET /api/job/[id]
// since the homepage only needs jobId + destinations, not the full
// itinerary, to render the "see a real example" link.

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { loadJob } from "@/lib/loadJob";
import { DEMO_TRIP_KEY, readDemoTrip, type DemoTrip } from "@/lib/demoTrip";
import { demoPreviewOf } from "@/lib/demoPreview";
import { readShowcaseList, SHOWCASE_LIST_KEY, type ShowcaseTrip } from "@/lib/showcase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many of the newest showcase entries to try when there is no demo,
 * so one expired job at the end of the list does not hide the rest. */
const SHOWCASE_FALLBACK_TRIES = 3;

async function previewFor(jobId: string) {
  // Confirm the underlying job still exists and finished successfully -
  // the demo trip's own record has no TTL, but the job it points at does
  // (JOB_TTL_SECONDS), so this is what actually catches a stale link
  // rather than showing a dead one.
  const job = await loadJob(jobId);
  if (!job || job.status !== "done" || !job.result) return null;
  // The excerpt only - never job.brief, which carries the private fields
  // (see lib/demoPreview.ts).
  return demoPreviewOf(job.result);
}

export async function GET() {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ demo: null });
  }

  try {
    // An unreadable value is no demo, not a 500. The parse used to sit
    // outside every try on a route the homepage calls, while this
    // feature's whole argument is that a demo which cannot be shown is not
    // shown.
    const demo = readDemoTrip(await redis.get<string | DemoTrip>(DEMO_TRIP_KEY));
    if (demo) {
      const preview = await previewFor(demo.jobId);
      if (preview) return NextResponse.json({ demo: { ...demo, preview } });
    }

    // No demo chosen, or its job has expired: the newest entry in the
    // public "Real examples" gallery is the same kind of thing - a real
    // trip an admin chose to show - so it stands in rather than the
    // homepage showing nothing.
    const raw = await redis.lrange<string | ShowcaseTrip>(SHOWCASE_LIST_KEY, 0, -1);
    const newestFirst = readShowcaseList(raw)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, SHOWCASE_FALLBACK_TRIES);
    for (const entry of newestFirst) {
      const preview = await previewFor(entry.jobId);
      if (preview) {
        return NextResponse.json({
          demo: { jobId: entry.jobId, destinations: entry.destinations, setAt: entry.addedAt, preview },
        });
      }
    }
  } catch {
    // Redis down is no demo, same as above.
  }

  return NextResponse.json({ demo: null });
}
