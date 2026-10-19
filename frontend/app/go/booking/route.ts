// A hotel link, on its way to Booking.com through the right affiliate
// programme for where the traveller is (lib/bookingLinks.ts). The country
// comes from Vercel's own header on the request, at the moment of the
// click - not from the trip, and not stored anywhere.
//
// Only ever redirects to a Booking.com search: anything else in ?u= is
// refused, so this cannot be used to send people to another site.

import { NextRequest, NextResponse } from "next/server";
import { affiliateIds, bookingRedirectFor } from "@/lib/bookingLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("u") ?? "";
  const country = request.headers.get("x-vercel-ip-country");
  const destination = bookingRedirectFor(target, country, affiliateIds());
  if (!destination) {
    return new NextResponse("This link is not valid.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const response = NextResponse.redirect(destination, 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
