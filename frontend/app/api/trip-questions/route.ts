// A general trip-Q&A endpoint — packing, safety, local customs, weather-
// appropriate clothing, that kind of practical question — deliberately
// separate from /api/generate's itinerary engine and NOT routed through the
// worker's job queue. That queue exists specifically to escape Vercel's
// function-duration limit for the web_search tool used during full
// itinerary generation (see README's Phase 1 -> Phase 2 history: the
// original Phase 1 /api/generate called Anthropic directly, exactly like
// this route does, and only moved to a worker once search made a single
// request too slow for a serverless function). A short conversational
// answer with no search and no large JSON schema to fill doesn't have that
// problem, so it's simpler and faster to just call Anthropic directly here
// and return within one request.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientIp, TRIP_QUESTIONS_RATE_LIMIT } from "@/lib/ratelimit";
import { checkDailyBudget, recordSpend } from "@/lib/spendCheck";
import { estimateCostUsd } from "@/lib/costBudget";
import { MAX_TRIP_QA_HISTORY, MAX_TRIP_QA_MESSAGE_LENGTH, type TripQAContext, type TripQAMessage } from "@/lib/tripQA";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 500;

const SYSTEM_PROMPT = `You are a friendly, knowledgeable travel assistant helping with practical trip \
questions: what to pack, whether an area is safe at night, whether to bring insect repellent or a \
specific medication, local customs, plug types, tipping norms, that kind of thing. This is NOT the \
full itinerary planner — don't offer to build a day-by-day plan, just answer the question directly.

WRITING STYLE: write like a knowledgeable friend texting back, not like an AI assistant. Never use \
an em dash ("—"). Keep answers short: a few sentences for a simple question, a short paragraph at \
most for a more involved one. Be direct and specific, not wishy-washy or over-hedged — give a real, \
useful answer.

If trip context (destination, dates, travelers, interests) is provided below, use it to tailor the \
answer specifically (season-appropriate clothing, region-specific safety notes) rather than generic \
advice. If no context is given and the question genuinely can't be answered without it (e.g. "what \
should I pack" with no destination mentioned anywhere), ask ONE brief clarifying question instead of \
guessing.

Be honest about uncertainty: for anything time-sensitive or safety-critical (a specific current \
travel advisory, a disease outbreak, a political situation), say plainly that you don't have live, \
current information and the traveler should check an official source (their government's travel \
advisory site, the CDC, etc.) — don't state something time-sensitive as settled fact.`;

function languageLabel(language: Language): string {
  return language === "bg" ? "Bulgarian (български)" : "English";
}

function contextBlock(context: TripQAContext | undefined, language: Language): string {
  const lines: string[] = [];
  if (context?.destinations?.length) lines.push(`Destination(s): ${context.destinations.join(", ")}`);
  if (context?.start_date && context?.end_date) lines.push(`Dates: ${context.start_date} to ${context.end_date}`);
  if (context?.party_composition) lines.push(`Travelers: ${context.party_composition}`);
  if (context?.interests?.length) lines.push(`Interests: ${context.interests.join(", ")}`);
  lines.push(`Respond in ${languageLabel(language)}.`);
  return `Trip context:\n${lines.join("\n")}`;
}

function isValidMessage(m: unknown): m is TripQAMessage {
  if (typeof m !== "object" || m === null) return false;
  const role = (m as Record<string, unknown>).role;
  const content = (m as Record<string, unknown>).content;
  if (role !== "user" && role !== "assistant") return false;
  if (typeof content !== "string") return false;
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TRIP_QA_MESSAGE_LENGTH;
}

export async function POST(request: NextRequest) {
  let body: { messages?: unknown; context?: TripQAContext; language?: Language };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0 || !rawMessages.every(isValidMessage)) {
    return NextResponse.json(
      {
        detail: `Each message needs a role ("user" or "assistant") and non-empty content under ${MAX_TRIP_QA_MESSAGE_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }
  const messages = rawMessages as TripQAMessage[];
  if (messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ detail: "The last message must be from the user." }, { status: 400 });
  }
  // The client keeps the full visible history; only the most recent
  // messages are actually sent, bounding cost/latency on a long chat.
  const trimmedMessages = messages.slice(-MAX_TRIP_QA_HISTORY);

  const language: Language = body.language === "bg" ? "bg" : "en";

  let redis;
  try {
    redis = getRedis();
  } catch {
    return NextResponse.json(
      { detail: "Server is misconfigured (rate limiting/budget tracking is not set up)." },
      { status: 500 }
    );
  }

  const budget = await checkDailyBudget(redis);
  if (!budget.allowed) {
    return NextResponse.json(
      { detail: "We've hit today's usage budget. Please try again tomorrow." },
      { status: 503 }
    );
  }

  const rateLimit = await checkRateLimit(redis, getClientIp(request), TRIP_QUESTIONS_RATE_LIMIT);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    return NextResponse.json(
      { detail: `Too many requests — ${rateLimit.reason}. Try again in ~${minutes} minute(s).` },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ detail: "Server is misconfigured (invalid API key)." }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: contextBlock(body.context, language) },
      ],
      messages: trimmedMessages.map((m) => ({ role: m.role, content: m.content })),
    });

    // Billed whether or not the reply below turns out empty, same principle
    // as the worker's onUsage in callModel — record it right away.
    await recordSpend(redis, estimateCostUsd(response.usage));

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const reply = textBlocks
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { detail: "The assistant didn't return a reply. Try rephrasing your question." },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply });
  } catch (e) {
    console.error("[trip-questions] model call failed:", e);
    const detail =
      e instanceof Anthropic.AuthenticationError
        ? "Server is misconfigured (invalid API key)."
        : e instanceof Anthropic.RateLimitError
          ? "Rate limited by the model provider. Try again shortly."
          : e instanceof Anthropic.APIConnectionError
            ? "Could not reach the model provider. Try again shortly."
            : e instanceof Anthropic.APIError
              ? `Model provider error: ${e.message}`
              : "Unexpected error answering your question.";
    return NextResponse.json({ detail }, { status: 500 });
  }
}
