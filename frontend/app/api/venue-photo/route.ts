// Serves one Google Places photo, by resource name.
//
// A proxy rather than a direct URL for two reasons. Google's photo
// endpoint takes the API key as a query parameter, so linking to it from
// the page would publish the key to anyone who opened dev tools. And the
// fetch is billed per photo, which means the app needs to be the one
// deciding how often it happens: this route caches hard, so a trip that is
// opened twenty times pays for its photos once.
//
// The name comes from Places itself (worker/src/engine/venueVerification.ts
// records it during the verification pass that already runs), so nothing
// here chooses a venue or spends a search. It only turns a name the
// itinerary already carries into bytes.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Long, because a venue's photo does not change and every re-fetch is
 * billed again. A day cache turns "twenty page views" into one request. */
const CACHE_SECONDS = 60 * 60 * 24 * 30;

/** Wide enough to look right at the sizes the itinerary uses on a 3x
 * phone, small enough not to pull a full-resolution image for a thumbnail. */
const MAX_WIDTH_PX = 800;

/** Places photo names look like "places/<id>/photos/<token>". Validated
 * rather than trusted: this route holds an API key, so the one thing it
 * must never do is forward an arbitrary caller-supplied path to Google. */
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") ?? "";
  if (!PHOTO_NAME.test(name)) {
    return NextResponse.json({ detail: "Invalid photo name." }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  // No key configured is not an error worth surfacing to a traveler - the
  // itinerary is complete without pictures, and every other Places-derived
  // signal degrades the same silent way.
  if (!apiKey) return new NextResponse(null, { status: 404 });

  const url =
    `https://places.googleapis.com/v1/${name}/media` +
    `?maxWidthPx=${MAX_WIDTH_PX}&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`;

  try {
    // skipHttpRedirect gives a small JSON body with the real image URI
    // instead of a 302. Following the redirect ourselves would stream the
    // bytes through this function and bill Vercel for the transfer; handing
    // the browser the URI lets Google serve the image directly.
    const res = await fetch(url, { next: { revalidate: CACHE_SECONDS } });
    if (!res.ok) return new NextResponse(null, { status: 404 });

    const data = (await res.json()) as { photoUri?: string };
    if (!data.photoUri) return new NextResponse(null, { status: 404 });

    return NextResponse.redirect(data.photoUri, {
      status: 307,
      headers: {
        // The redirect target is signed and expires, so the redirect
        // itself is cached for much less time than the upstream lookup.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
