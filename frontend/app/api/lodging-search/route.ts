// Google Maps suggestions for "Where are you staying?" in the trip form.
// GET ?q=sandmusch&near=Friedrichshafen&lang=en
//
// Google Places Autocomplete, centred on the trip's first destination so
// "Hilton" offers the Hilton in that city, not every Hilton on earth. The
// key stays on the server, as with /api/venue-photo. Rate limited per
// visitor because each call is billed, and cached because the same text
// near the same city always has the same answer.
//
// Without GOOGLE_PLACES_API_KEY it answers with nothing and the field is a
// plain text box, exactly as before.

import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientIp, LODGING_SEARCH_RATE_LIMIT } from "@/lib/ratelimit";
import { locateCity, worldCities } from "@/lib/worldCities";

export const runtime = "nodejs";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

export interface LodgingSuggestion {
  /** The place's name, e.g. "Ferien-Apartment Sandmuschel". */
  name: string;
  /** Where it is, e.g. "Seestraße 12, Friedrichshafen, Germany". */
  address: string;
}

interface Prediction {
  placePrediction?: {
    text?: { text?: string };
    structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
  };
}

const EMPTY = { suggestions: [] as LodgingSuggestion[] };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const near = (params.get("near") ?? "").trim().slice(0, 80);
  const language = params.get("lang") === "bg" ? "bg" : "en";
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || q.length < 3) return NextResponse.json(EMPTY);

  try {
    const limit = await checkRateLimit(getRedis(), getClientIp(request), LODGING_SEARCH_RATE_LIMIT);
    if (!limit.allowed) return NextResponse.json(EMPTY, { status: 429 });
  } catch {
    // The limiter being unreachable is not a reason to call Google
    // without one.
    return NextResponse.json(EMPTY);
  }

  const center = near ? locateCity(worldCities(), near) : null;
  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({
        input: q,
        languageCode: language,
        ...(center && {
          locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 30000 } },
        }),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.warn(`[lodging-search] Places answered HTTP ${res.status}`);
      return NextResponse.json(EMPTY);
    }
    const data = (await res.json()) as { suggestions?: Prediction[] };
    const suggestions: LodgingSuggestion[] = [];
    for (const s of data.suggestions ?? []) {
      const p = s.placePrediction;
      const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
      if (typeof name !== "string" || !name.trim()) continue;
      const address = p?.structuredFormat?.secondaryText?.text;
      suggestions.push({ name: name.trim(), address: typeof address === "string" ? address.trim() : "" });
    }
    return NextResponse.json(
      { suggestions: suggestions.slice(0, 5) },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
    );
  } catch (e) {
    console.warn("[lodging-search]", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json(EMPTY);
  }
}
