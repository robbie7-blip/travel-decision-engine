// Protects /admin/* with HTTP Basic Auth. Deliberately minimal — this is a
// single-owner internal tool (browsing feedback entries), not a multi-user
// auth system, so a shared password checked at the edge is proportional.
// Uses atob (not Buffer) since middleware runs on the Edge runtime by
// default, which doesn't have Node's Buffer global.

import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse("Admin view is not configured (ADMIN_PASSWORD is not set).", {
      status: 503,
    });
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice("Basic ".length));
      const password = decoded.split(":").slice(1).join(":"); // username is ignored
      if (password === expected) {
        return NextResponse.next();
      }
    } catch {
      // fall through to the 401 below
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}

export const config = {
  // /api/admin/:path* covers the demo-trip admin API (see
  // app/api/admin/demo-trip/route.ts) — it lives under /api, not /admin,
  // since Next.js route handlers alongside a page path is unconventional,
  // so it needs its own matcher entry rather than falling under /admin/:path*.
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
