// The signed-in traveller's own trips, from the Postgres archive - what
// makes "your trips" follow someone from their laptop to their phone.
//
// Only ever the session's own address: there is no parameter that names
// whose trips to list, so there is nothing to change to read someone
// else's. Private and uncached for the same reason.
//
// Degrades to an empty list, never an error: the browser keeps its own
// list (lib/recentTrips.ts) either way, and the homepage must not show a
// failure because the archive is down or not configured.

import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getDb } from "@/lib/db";
import { listMyTrips, type MyTrip } from "@/lib/tripsQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) return NextResponse.json({ signedIn: false, trips: [] }, { headers: NO_STORE });

  let trips: MyTrip[] = [];
  const db = getDb();
  if (db) {
    try {
      trips = await listMyTrips(db, email);
    } catch (e) {
      // The table may not exist yet (no worker has started against this
      // database), or the database is unreachable. Logged, not shown.
      console.warn("[account/trips] could not list trips:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  return NextResponse.json({ signedIn: true, trips }, { headers: NO_STORE });
}
