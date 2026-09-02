// Resolves a city name to an ISO country code, for the "add this trip to
// Places you've been" prompt at the end of an itinerary.
//
// Open-Meteo's geocoder, the same free no-key service /api/weather already
// uses, returns country_code alongside the coordinates. That makes this a
// zero-cost lookup: no model call, no paid geocoding key, and no new
// dependency for a feature whose whole value is being free to run.
//
// Server-side rather than called from the browser so the destination names
// a traveler typed are not sent from their device to a third party, and so
// the response can be cached at the edge - city-to-country does not change.

import { NextRequest, NextResponse } from "next/server";
import { getCountry } from "@/lib/countries";

export const runtime = "nodejs";
// A day. The answer is stable; this is really just about not hitting
// Open-Meteo once per page view for the same handful of cities.
export const revalidate = 86400;

const MAX_CITIES = 6;

interface GeoResult {
  country_code?: string;
  name?: string;
}

async function countryCodeFor(city: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      { next: { revalidate } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: GeoResult[] };
    const code = data.results?.[0]?.country_code?.toUpperCase();
    // Checked against the real country list rather than trusted, the same
    // way flight-import validates the code the model returns - a code this
    // app has no country for would put an unrenderable entry on the map.
    return code && getCountry(code) ? code : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("cities") ?? "";
  const cities = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_CITIES);

  if (cities.length === 0) return NextResponse.json({ countries: [] });

  const codes = await Promise.all(cities.map(countryCodeFor));
  // Deduplicated: a two-city trip inside one country is one country to add.
  const countries = [...new Set(codes.filter((c): c is string => c !== null))];
  return NextResponse.json({ countries });
}
