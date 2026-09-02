// Extracts a traveler's own flights from a pasted booking confirmation.
// Synchronous, like /api/trip-questions and unlike /api/generate: one
// bounded model call with a small structured output, so there's nothing to
// justify the job-queue round trip.
//
// Reads nothing and stores nothing. The pasted text is used for the one
// extraction call and then it's gone - no Redis write, no logging of the
// body. Booking confirmations carry names, booking references, and
// sometimes partial card details, none of which this feature needs, so the
// safest place to keep them is nowhere. Only the flights the traveler then
// confirms get written, and they go through the existing /api/visited
// write path rather than a second one invented here.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, isMissingWorkspaceIdError } from "@/lib/anthropicClient";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientIp, FLIGHT_IMPORT_RATE_LIMIT } from "@/lib/ratelimit";
import { checkDailyBudget, recordSpend } from "@/lib/spendCheck";
import { estimateCostUsd } from "@/lib/costBudget";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import { getCountry } from "@/lib/countries";
import {
  MAX_FLIGHT_IMPORT_CHARS,
  MIN_FLIGHT_IMPORT_CHARS,
  type FlightImportResult,
  type ImportedFlight,
} from "@/lib/flightImport";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

const SYSTEM_PROMPT = `You extract flight legs from a travel booking confirmation email.

Return ONLY this JSON, no other text:
{"flights": [{"departure_iata": "SOF", "departure_city": "Sofia", "arrival_iata": "RMO", "arrival_city": "Chisinau", "arrival_country_code": "MD", "date": "2026-12-28", "airline": "Wizz Air", "flight_number": "W6 1234"}]}

Rules:
- One entry per FLIGHT LEG, in travel order. A return trip is two legs. A connection is two legs.
- "arrival_country_code" is the ISO 3166-1 alpha-2 code of the country the arrival airport is in ("MD" for Chisinau, "GB" for London, "US" for New York). This is the field that matters most - get it right from the airport, not from the airline's nationality.
- "date" is the local departure date of that leg, as YYYY-MM-DD. If the year is genuinely absent, infer the most plausible one from the rest of the email rather than guessing wildly.
- Include airline and flight_number when present; omit them when not.
- If a field other than the ones above is missing, omit it. Never invent an airport, a city, a date or a code.
- If the text contains no flight booking at all (a hotel confirmation, a newsletter, random text), return exactly: {"flights": []}
- Ignore everything that isn't a flight: seat selection, baggage, loyalty points, marketing, fare rules, quoted reply chains.

Never include the passenger's name, booking reference, ticket number, or any payment detail in your output. They are not part of the schema and are not wanted.`;

function extractJson(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const parts = t.split("```");
    t = parts[1] ?? t;
    if (t.startsWith("json")) t = t.slice(4);
  }
  return t.trim();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RawFlight {
  departure_iata?: unknown;
  departure_city?: unknown;
  arrival_iata?: unknown;
  arrival_city?: unknown;
  arrival_country_code?: unknown;
  date?: unknown;
  airline?: unknown;
  flight_number?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Turns the model's output into flights we're willing to act on. The
 * country code is checked against the real country list rather than
 * trusted - a hallucinated code would otherwise mark a country visited
 * that the traveler has never been to, which is the one error this feature
 * absolutely must not make. */
function toImportedFlights(raw: unknown): ImportedFlight[] {
  const list = Array.isArray((raw as { flights?: unknown })?.flights)
    ? ((raw as { flights: RawFlight[] }).flights)
    : [];
  const today = new Date().toISOString().slice(0, 10);
  const out: ImportedFlight[] = [];

  for (const f of list) {
    const arrivalCountryCode = str(f.arrival_country_code).toUpperCase();
    const date = str(f.date);
    const arrivalIata = str(f.arrival_iata).toUpperCase();
    if (!arrivalCountryCode || !getCountry(arrivalCountryCode)) continue;
    if (!ISO_DATE_RE.test(date)) continue;
    if (!arrivalIata) continue;

    out.push({
      arrivalIata,
      arrivalCity: str(f.arrival_city) || arrivalIata,
      arrivalCountryCode,
      departureIata: str(f.departure_iata).toUpperCase(),
      departureCity: str(f.departure_city),
      date,
      airline: str(f.airline) || undefined,
      flightNumber: str(f.flight_number) || undefined,
      isPast: date <= today,
    });
  }
  return out;
}

export async function POST(request: NextRequest) {
  // Signed in, because the result is written against an account's visited
  // list. Also means a forwarded/pasted confirmation can only ever affect
  // the history of the person who pasted it.
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!email) {
    return NextResponse.json({ detail: "Sign in to import your flight history." }, { status: 401 });
  }

  let body: { text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < MIN_FLIGHT_IMPORT_CHARS) {
    return NextResponse.json({ detail: "Paste the whole confirmation email - that looks too short." }, { status: 400 });
  }
  if (text.length > MAX_FLIGHT_IMPORT_CHARS) {
    return NextResponse.json(
      { detail: `That's longer than ${MAX_FLIGHT_IMPORT_CHARS} characters - paste just the confirmation itself.` },
      { status: 400 }
    );
  }

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json({ detail: "Server is misconfigured." }, { status: 500 });
  }

  const budget = await checkDailyBudget(redis);
  if (!budget.allowed) {
    return NextResponse.json({ detail: "We've hit today's usage budget. Please try again tomorrow." }, { status: 503 });
  }

  const rateLimit = await checkRateLimit(redis, getClientIp(request), FLIGHT_IMPORT_RATE_LIMIT);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many imports - ${rateLimit.reason}. Try again in ~${minutes} minute(s).` },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ detail: "Server is misconfigured (invalid API key)." }, { status: 500 });
  }

  try {
    const client = createAnthropicClient({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: text }],
    });

    // Billed whether or not the parse below succeeds.
    await recordSpend(redis, estimateCostUsd(response.usage)).catch(() => {});

    // A truncated response is broken JSON, and broken JSON lands in the
    // catch below as "couldn't read that confirmation" - which blames the
    // traveler's email for a cap of ours. A long multi-leg booking is
    // exactly the case that hits this, and it is the case where getting it
    // right matters most.
    if (response.stop_reason === "max_tokens") {
      console.error(`[flight-import] hit the ${MAX_TOKENS}-token ceiling before finishing the JSON`);
      return NextResponse.json(
        { detail: "That confirmation has more flights than we can read at once. Try pasting one trip at a time." },
        { status: 502 }
      );
    }

    const blocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const flights = toImportedFlights(JSON.parse(extractJson(blocks[blocks.length - 1]?.text ?? "")));

    // Only past flights count as a visit - a future booking is a plan.
    const countryCodes = [...new Set(flights.filter((f) => f.isPast).map((f) => f.arrivalCountryCode))];
    const result: FlightImportResult = { flights, countryCodes };
    return NextResponse.json(result);
  } catch (e) {
    // Logged, not swallowed. This catch used to be a bare `catch {}` that
    // told the traveler "couldn't read that confirmation, try pasting the
    // full email text" for EVERY failure - including an expired API key or
    // a missing workspace id. That blames the person's email for a fault
    // that is entirely ours, sends them off to re-copy text that was
    // already fine, and leaves no trace anywhere of what actually broke.
    console.error("[flight-import] failed:", e);
    if (isMissingWorkspaceIdError(e) || e instanceof Anthropic.AuthenticationError) {
      console.error(
        "[flight-import] THIS IS A CONFIGURATION FAILURE - check ANTHROPIC_API_KEY and " +
          "ANTHROPIC_WORKSPACE_ID on this deployment"
      );
      return NextResponse.json(
        { detail: "Flight import is temporarily unavailable. That's on us, not your email." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { detail: "Couldn't read that confirmation. Try pasting the full email text." },
      { status: 502 }
    );
  }
}
