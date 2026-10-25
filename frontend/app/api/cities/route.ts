// City suggestions for the destination and origin fields, from the full
// world list (lib/worldCities.ts). GET ?q=fried&lang=en
//
// Public and cached: the answer depends only on the query, holds nothing
// about the visitor, and the list changes only when the data file does.

import { NextRequest, NextResponse } from "next/server";
import { searchCities, worldCities } from "@/lib/worldCities";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 60);
  const language = request.nextUrl.searchParams.get("lang") === "bg" ? "bg" : "en";
  try {
    return NextResponse.json(
      { cities: searchCities(worldCities(), q, language) },
      { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } }
    );
  } catch (e) {
    console.warn("[cities]", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ cities: [] }, { status: 500 });
  }
}
