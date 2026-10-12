// Optional cross-device sync for the visited-countries tracker. The tracker
// itself is local-storage-first and needs no account at all (see
// lib/localVisited.ts + app/account/visited/page.tsx) - this route is only
// hit when someone chooses to sign in so their list follows them to another
// device too. Session-gated the same as /api/account since it's account
// state once someone opts in.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getVisitedEntries, setVisitedEntry, computeVisitedStats, type VisitedPin } from "@/lib/visited";

export const runtime = "nodejs";

function requireEmail(request: NextRequest): string | null {
  return verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

// Loose on purpose - this only guards against garbage breaking storage
// downstream, not full schema validation. A malformed pin is just dropped
// rather than rejecting the whole request over one bad entry.
function parsePins(value: unknown): VisitedPin[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pins: VisitedPin[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.label !== "string") continue;
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    pins.push({
      id: p.id,
      label: p.label.slice(0, 200),
      lat: p.lat,
      lng: p.lng,
      ...(typeof p.note === "string" ? { note: p.note.slice(0, 500) } : {}),
    });
  }
  return pins;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const email = requireEmail(request);
  if (!email) {
    // 200, NOT 401, and the same shape /api/account answers with.
    //
    // Being signed out is the ordinary state of this endpoint: the tracker
    // works entirely from localStorage and this route exists only for
    // people who opted into syncing it (see the header above). So a
    // signed-out visitor opening /account/visited is not an unauthorized
    // request, it is the normal one - and answering 401 made every such
    // visit log a red "Failed to load resource: 401" in the browser
    // console. That is noise in the one place a real error would have to
    // show up to be noticed.
    //
    // It also removes a conflation on the client, which checked `!r.ok`
    // and treated 401 and 500 identically with the comment "either way,
    // stay in local-only mode". A misconfigured server was therefore
    // indistinguishable from being signed out. Now only a genuine fault
    // is not-ok.
    //
    // POST keeps its 401: a WRITE from someone with no session really is
    // unauthorized, and the page does not make one unless it knows it is
    // signed in - so that status stays a backstop rather than a normal
    // answer.
    return NextResponse.json({ signedIn: false, entries: [], stats: computeVisitedStats([]) });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const entries = await getVisitedEntries(redis, email);
  return NextResponse.json({ signedIn: true, entries, stats: computeVisitedStats(entries.map((e) => e.code)) });
}

export async function POST(request: NextRequest) {
  const email = requireEmail(request);
  if (!email) {
    return NextResponse.json({ detail: "Sign in to track visited places." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const code = typeof b?.code === "string" ? b.code : "";
  const visited = Boolean(b?.visited);
  const visitedAt = typeof b?.visitedAt === "string" && ISO_DATE_RE.test(b.visitedAt) ? b.visitedAt : undefined;
  const pins = parsePins(b?.pins);
  if (!code.trim()) {
    return NextResponse.json({ detail: "code is required." }, { status: 400 });
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  await setVisitedEntry(redis, email, code, visited, { visitedAt, pins });
  const entries = await getVisitedEntries(redis, email);
  return NextResponse.json({ entries, stats: computeVisitedStats(entries.map((e) => e.code)) });
}
