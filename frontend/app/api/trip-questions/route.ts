// A general trip-Q&A endpoint - packing, safety, local customs, weather-
// appropriate clothing, that kind of practical question - deliberately
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
//
// Streamed, not a single blocking JSON response: a non-streamed reply feels
// noticeably slower than ChatGPT/Gemini even when the actual generation
// time is similar, because nothing appears until the entire answer is
// done - streaming shows the first words almost immediately, which is most
// of what "feels instant" actually comes from. The response body is plain
// UTF-8 text chunks (not the Anthropic SDK's own SSE wire format) so the
// client can read it with a bare fetch + ReadableStream reader, no SDK
// bundled into client-side code.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, isMissingWorkspaceIdError } from "@/lib/anthropicClient";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientIp, TRIP_QUESTIONS_RATE_LIMIT } from "@/lib/ratelimit";
import { contextBlock, readTripQAContext } from "@/lib/tripQAContext";
import { checkDailyBudget, recordSpend } from "@/lib/spendCheck";
import { estimateCostUsd } from "@/lib/costBudget";
import { getUserRecord, resolvePlan } from "@/lib/account";
import { describePlace, lookUpPlace } from "@/lib/placeLookup";
import { applyToolStep, nextToolStep, type ToolRoundState } from "@/lib/toolRounds";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";
import {
  MAX_TRIP_QA_HISTORY,
  MAX_TRIP_QA_IMAGE_BYTES,
  MAX_TRIP_QA_IMAGES_PER_MESSAGE,
  MAX_TRIP_QA_IMAGES_SENT,
  MAX_TRIP_QA_MESSAGE_LENGTH,
  TRIP_QA_IMAGE_MEDIA_TYPES,
  isLocalVoice,
  type LocalVoice,
  type TripQAImage,
  type TripQAMessage,
} from "@/lib/tripQA";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";

// The only route in this app that sets this, because it is the only one
// that streams model output straight to the browser for as long as the
// model keeps writing. Everything else either answers in milliseconds or
// hands the work to the Railway worker and returns a job id.
//
// Vercel's default for a Node function is on the order of ten or fifteen
// seconds. MAX_TOKENS below is 3000, which at Sonnet's output rate is
// roughly thirty seconds of streaming, so without this the longest
// answers would be cut off by the platform rather than by the ceiling -
// and a connection dropped mid-word says nothing to the traveler, while
// the ceiling at least appends a line explaining itself. 60 is the cap on
// every Vercel plan including Hobby, so this is portable; if the plan
// allows less, the build says so rather than failing at runtime.
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";
// 500 was too tight for the questions people actually ask. A traveler
// asked "Sharm El-Sheikh or Hurghada for a family weekend in January?" -
// a real comparison, and the right answer is a short list of differences
// per option. It ran out of room and stopped at "minimizing transfer time
// and", mid-sentence, with nothing anywhere saying it had been cut.
//
// This is a ceiling, not a spend: output is billed on what the model
// actually writes, and the system prompt still asks for a few sentences.
// Raising it costs nothing on the short answers and stops truncating the
// legitimately longer ones.
//
// AND 1500 WAS STILL TOO TIGHT, reported from a phone: "Switzerland and
// Liechtenstein Christmas markets, or Barcelona and Andorra, in December"
// - two itineraries to weigh against each other, each with several towns -
// stopped at "Barcelona in December is mild and pleasant for walking" and
// then admitted it had been cut off. The suffix did its job; the answer
// was still half an answer.
//
// 3000, not more, and the reason is the clock rather than the money.
// maxDuration below caps how long this function may stream for, and at
// Sonnet's output rate 3000 tokens is roughly 30 seconds of it. A ceiling
// the time budget cannot cover would trade a truncation that explains
// itself for the platform cutting the connection mid-word, which is
// strictly worse. The two numbers only make sense together.
const MAX_TOKENS = 3000;

// Pro-only: gives a signed-in Pro traveler's questions the same
// web_search tool the itinerary engine uses (see worker/src/index.ts's
// SEARCH_INSTRUCTIONS/web_search_20260209 declaration) so a question like
// "is it going to rain in Lisbon next week" or "is [venue] actually still
// open" gets a real, current answer instead of the honest-but-unhelpful
// "I don't have live info, check an official source" the base system
// prompt falls back to. Free stays exactly as it was - this is additive
// capability, not a cap on how many questions anyone can ask (see
// pricing.freePlanFeatures/paidPlanFeatures: both plans are "unlimited
// Ask a Local Q&A").
//
// Capped low (2, vs. the itinerary engine's estimateMaxSearchUses which
// can go much higher across a multi-day plan): a single conversational
// question rarely needs more than one or two searches, and this route is
// a synchronous request (no job queue - see the file-header comment
// above), so keeping search usage small keeps it comfortably inside
// Vercel's function-duration limit the same way the plain-text/no-search
// free path already does.
// Stands in for the question when a photo is sent with no typed text -
// sending the picture IS the question in that case.
const IMPLIED_PHOTO_QUESTION = "What am I looking at here, and is there anything I should know about it?";

// Added only when the request actually carries a photo. The failure mode
// worth prompting against is specific: this feature gets used standing in
// a hotel room deciding whether to open something that might cost €12, so
// a confident guess is materially worse than "I can't tell from this". The
// existing system prompt already sets the honest-hedging tone; this points
// it at what's different about reading a picture - that the answer often
// hinges on small print that may be cropped, blurred, or in another
// language.
const PHOTO_ADDENDUM = `\n\nThe traveler has attached a photo. Answer from what you can actually see in it.

Be specific about what you can read: if a price, a label, a room number or a policy line is legible, quote it \
back so they know you're reading the same thing they are. Translate any text that isn't in their language.

Say plainly when the image doesn't settle it. Cropped, blurry or partially visible small print is the normal \
case here, not an edge case - "I can see the water is listed but the price column is cut off, tilt it down and \
I'll tell you" is a genuinely useful answer, and far better than a confident guess. Never state a price, a rule \
or an ingredient as fact if you're actually inferring it from context rather than reading it.

Where the honest answer is "this varies by property" (minibars especially - some hotels comp the water and \
charge for everything else), say so and tell them the reliable way to check: the printed price card, the room \
compendium, or a quick call to reception. Costing someone an unexpected charge because you guessed is the one \
outcome worth being careful about.`;

// The place-lookup tool, available on BOTH plans.
//
// This is what a traveler means by "research it by name". It is not web
// search and does not touch that Pro gate: it asks Google Places one
// question about one named business - is it real, how is it rated, where
// is it, roughly what does it cost, is it still open - which is the same
// source the itinerary engine has verified venues with all along.
//
// Added because of a real answer. Asked to compare two guesthouses by
// name, the free path replied "I can't actually browse the internet or
// look up live listings... I only work from what's given to me in our
// conversation". True of that path, and still the wrong answer: the
// capability was configured on this deployment and the question could
// not reach it.
const PLACE_LOOKUP_TOOL = {
  name: "look_up_place" as const,
  description:
    "Look up a specific named business or landmark in Google Places - a hotel, guesthouse, restaurant, " +
    "bar, museum or shop. Returns whether it exists, its rating and review count, address, price level, " +
    "whether it is still operating, and its opening hours. Use this whenever the traveler names a " +
    "specific place and the answer depends on what that place is actually like - comparing two hotels, " +
    "checking somewhere is real before they book, confirming a restaurant is still open. Do not use it " +
    "for cities, neighbourhoods or regions, which are not businesses.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description:
          "The place name plus where it is, as you would type it into Google Maps - for example " +
          "\"Hotel Artemide Rome\" or \"Chilling Jacuzzi Suite Guesthouse Rome\". Always include the " +
          "city, since names repeat across the world.",
      },
    },
    required: ["query"],
  },
};

/** How many look_up_place calls are answered in one round.
 *
 * Comparing two or three candidates is the case this exists for, and the
 * model asks for them in a single round. The cap is what stops a question
 * about "the best restaurants here" turning into fifteen billed lookups
 * and a reply the traveler waited half a minute for. */
const MAX_PLACE_LOOKUPS_PER_ROUND = 4;

/** How many times the model may come back for more lookups.
 *
 * Two, because this route is synchronous (no job queue) and every round
 * is another model round-trip inside the same function invocation - see
 * maxDuration at the top of this file. One round covers "look these two
 * up and answer"; the second covers "that name did not match, try the
 * other spelling", which is a real case. A third would mostly buy
 * latency. */
const MAX_TOOL_ROUNDS = 2;

const PLACE_LOOKUP_ADDENDUM = `\n\nYou have a look_up_place tool. Use it whenever the traveler names a \
specific business and the answer depends on what that place is really like - comparing two hotels, checking \
somewhere exists before they book, confirming a place is still open. Look up each named place rather than \
reasoning about the name.

Answer from what the lookup returns, and say where it came from in passing ("Google has it at 4.2 from 300 \
reviews"). A rating with a handful of reviews is weak evidence and worth saying so. If a lookup finds nothing, \
that often means a small or newly listed property rather than a fake one - say which you think it is and what \
would settle it. If a lookup could not be completed, say you could not check, never that the place was not \
found.

NEVER describe your own tools, your training data or what you can and cannot access. A traveler does not want \
to hear what kind of software you are. If something genuinely cannot be settled, answer with what you do know \
and name the single thing that would settle it.`;

const WEB_SEARCH_MAX_USES = 2;
const WEB_SEARCH_ADDENDUM = `\n\nYou also have a web_search tool available for this question - use it when a \
current/time-sensitive detail would actually change the answer (today's weather, whether a specific place is \
still open, a current price, a real advisory), not for background knowledge you already know. When you do use \
it, answer based on what you actually found, and you no longer need the "I don't have live info" hedge for \
whatever you searched. When a search gives you the actual URL behind a claim, paste it - that is the one case \
where you genuinely have a link rather than a guess at one, and it becomes tappable.`;

// Anthropic's backend occasionally returns a transient 529 "overloaded"
// error - confirmed happening in practice. One immediate retry (no
// artificial delay) resolves most of these, since a retry often lands on a
// different, non-overloaded backend. If both attempts fail, or any other
// error occurs, the traveler gets a short, friendly line instead of the
// raw provider error - never leak "Model provider error: 529 {...}" into
// the UI, that's both ugly and actively undermines trust in the product.
const MAX_MODEL_ATTEMPTS = 2;

// Two different failures, two different sentences, because "try again in a
// second" is only true for one of them.
//
// A transient overload really does clear on a retry. A CONFIGURATION
// failure - a key that has expired, or an identity-linked key with no
// ANTHROPIC_WORKSPACE_ID - never will, and telling someone to try again is
// sending them into a loop that cannot end. Both used to produce the same
// friendly line, which meant a dead API key looked exactly like a busy
// server: the traveler retried forever and the owner had no signal at all
// unless they happened to open Vercel's runtime logs.
const FALLBACK_REPLY: Record<Language, string> = {
  en: "Give me a second and try asking again, I'm a little overloaded right now.",
  bg: "Дай ми секунда и опитай пак, в момента съм малко претоварен.",
};

// Deliberately does NOT say "try again": it would not work. Says the fault
// is ours, because it is.
// Appended when the answer hit the token ceiling, so a sentence that stops
// halfway reads as an interruption rather than as the model's own idea of a
// finished thought.
const TRUNCATED_SUFFIX: Record<Language, string> = {
  en: "\n\n(That got cut off - ask me to keep going and I'll finish it.)",
  bg: "\n\n(Прекъснах се - кажи ми да продължа и ще довърша.)",
};

const MISCONFIGURED_REPLY: Record<Language, string> = {
  en: "Ask a Local is temporarily unavailable. That's a problem on our side, not with your question.",
  bg: "\u201eПитай местен\u201c временно не работи. Проблемът е при нас, не във въпроса ти.",
};

/** A failure that no number of retries will fix. */
function isConfigurationError(e: unknown): boolean {
  return isMissingWorkspaceIdError(e) || e instanceof Anthropic.AuthenticationError;
}

const SYSTEM_PROMPT = `You are a friendly, knowledgeable travel assistant helping with practical trip \
questions: what to pack, whether an area is safe at night, whether to bring insect repellent or a \
specific medication, local customs, plug types, tipping norms, that kind of thing. This is NOT the \
full itinerary planner - don't offer to build a day-by-day plan, just answer the question directly.

WRITING STYLE: write like a knowledgeable friend texting back, not like an AI assistant. Never use \
an em dash ("—"). Keep answers short: a few sentences for a simple question, a short paragraph at \
most for a more involved one. Be direct and specific, not wishy-washy or over-hedged - give a real, \
useful answer.

If trip context (destination, dates, travelers, interests) is provided below, use it to tailor the \
answer specifically (season-appropriate clothing, region-specific safety notes) rather than generic \
advice. If no context is given and the question genuinely can't be answered without it (e.g. "what \
should I pack" with no destination mentioned anywhere), ask ONE brief clarifying question instead of \
guessing.

Be honest about uncertainty: for anything time-sensitive or safety-critical (a specific current \
travel advisory, a disease outbreak, a political situation), say plainly that you don't have live, \
current information and the traveler should check an official source (their government's travel \
advisory site, the CDC, etc.) - don't state something time-sensitive as settled fact.

PLACES: when you name a specific place the traveler could actually walk to - a restaurant, a bar, a \
museum, a shop, a station - wrap the name in double square brackets the FIRST time you mention it, \
like [[Roscioli]] or [[Sant'Eustachio Il Caffe]]. That becomes a tappable map link.

Only mark real, specific, named places. Not cities, countries or neighbourhoods, and never a generic \
description: "[[a good trattoria nearby]]" is wrong, and so is "[[Trastevere]]". Mark each place once, \
on its first mention. If you are not naming somewhere specific, don't use the brackets at all - an \
answer with no place in it should have none.

Never write a Google Maps URL yourself. The brackets are how a map link gets made, and a maps address \
you compose from memory points at the wrong place often enough to be worse than no link.

URLS: don't invent them. Paste a URL only if you genuinely have it in front of you, in which case \
write it plainly and it will become a link. Otherwise name where to look ("the museum's own site", \
"your airline's app") instead of guessing an address.`;

// The chosen local perspective, appended to the system prompt.
//
// The point is not costume. It is that a real local's answer is anchored
// in a particular life: a cook tells you where the good tomatoes come from
// and which "traditional" place is for tourists, someone who works nights
// knows which streets are actually fine at 2am and which bus still runs.
// A flat assistant voice averages all of that away and gives you the
// guidebook.
//
// Two hard rules in every voice, both about honesty rather than tone.
// It must not invent a name, a family or a biography and present them as a
// real person, because a traveler acting on "my cousin runs a place on
// that street" deserves that to be true. And a perspective is not a licence
// to be more certain: the same uncertainty rules above still apply, and a
// local voice makes it MORE tempting to state a stale opening time as
// personal knowledge.
const LOCAL_VOICE_PROMPT: Record<LocalVoice, string> = {
  neighbour: `You are THE NEIGHBOUR. You have lived in this destination for years and you are fond \
of it without being starry-eyed: you know which street is worth the walk, which square is only \
worth it before nine in the morning, and where the queue is a tourist queue.
Manner: warm, unhurried, a little wry about your own city. You answer the question and then add \
the one thing they did not think to ask. You are happy to say a famous thing is overrated, because \
you have watched people queue for it for years.`,
  cook: `You are THE COOK. You cook and eat in this destination for a living: markets, what is \
actually in season right now, which dish is genuinely local and which one is on every menu for \
visitors, what a normal portion and a normal price look like, and where people who work in \
kitchens eat on their day off.
Manner: direct, specific, a bit impatient with anything fake. You talk in ingredients, hours and \
prices rather than adjectives. If they ask about a restaurant you would not go to, say so and give \
them somewhere better in the same five minutes' walk.`,
  night: `You are THE NIGHT OWL. Your day here runs late: you know which areas are genuinely fine \
to walk through after dark and which are just quiet rather than safe, what is still open, how \
people actually get home, which last transport is real and which one you should not count on.
Manner: calm and practical, never dramatic. Safety talk from you sounds like logistics, not \
warnings: which corner to wait on, which line to take, what time the thing they are counting on \
actually stops. You do not frighten people and you do not tell them everywhere is fine either.`,
  family: `You are THE PARENT. You do this destination with small children: what works and what \
does not, distances and pacing with short legs, where a bathroom and a bench actually are, which \
famous thing is worth the queue with kids in tow and which is a bad hour of everyone's life.
Manner: kind, practical, funny about how badly a day can go. You think in stretches of time and \
where the next sit-down is. You are honest that some things are simply not worth attempting this \
year and will be in three.`,
};

/** The chosen perspective as prompt text, plus the guardrails that hold in
 * every one of them. Empty when no voice is picked, which is the default. */
function voiceInstruction(voice: LocalVoice | null): string {
  if (!voice) return "";
  return `\n\nLOCAL PERSPECTIVE: ${LOCAL_VOICE_PROMPT[voice]}

Speak in the first person from that perspective, in that manner, and let it shape WHICH details \
you reach for - two characters given the same question should not return the same answer with \
different adjectives. Two things this never changes. Do not invent a name, a family, a workplace or any other biography and \
present it as a real person - you are decide answering from a local point of view, not a specific \
human being, and if you are asked who you are, say exactly that plainly. And do not become more \
confident than you have grounds to be: a lived-in voice makes it tempting to state an opening time \
or a current price as personal knowledge, and the honesty rules above still hold in full.`;
}

/** Base64 decodes to roughly 3 bytes per 4 chars - measured off the string
 * rather than decoding it, so an oversized payload is rejected without
 * first allocating it. */
function approxDecodedBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function isValidImage(v: unknown): v is TripQAImage {
  if (typeof v !== "object" || v === null) return false;
  const { mediaType, data } = v as Record<string, unknown>;
  if (typeof mediaType !== "string" || typeof data !== "string") return false;
  if (!(TRIP_QA_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) return false;
  if (data.length === 0 || approxDecodedBytes(data) > MAX_TRIP_QA_IMAGE_BYTES) return false;
  // Reject anything that isn't plain base64 - in particular a full
  // `data:image/...;base64,` URL, which the Anthropic API would refuse
  // further down with a much less obvious error.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(data);
}

function isValidMessage(m: unknown): m is TripQAMessage {
  if (typeof m !== "object" || m === null) return false;
  const role = (m as Record<string, unknown>).role;
  const content = (m as Record<string, unknown>).content;
  const images = (m as Record<string, unknown>).images;
  if (role !== "user" && role !== "assistant") return false;
  if (typeof content !== "string") return false;

  if (images !== undefined) {
    // Only a question can carry a photo - an assistant turn claiming one
    // would just be a way to smuggle image tokens into the request.
    if (role !== "user") return false;
    if (!Array.isArray(images) || images.length > MAX_TRIP_QA_IMAGES_PER_MESSAGE) return false;
    if (!images.every(isValidImage)) return false;
  }

  const trimmed = content.trim();
  // A photo on its own is a complete question ("what is this?" is implied
  // by the act of sending it), so empty text is only an error when there's
  // no image either.
  const hasImage = Array.isArray(images) && images.length > 0;
  if (trimmed.length === 0 && !hasImage) return false;
  // The length cap only ever guarded against an unreasonably long typed
  // *question* (see MAX_TRIP_QA_MESSAGE_LENGTH's own comment) - it was
  // never meant to apply to the assistant's own replies. At MAX_TOKENS
  // a normal reply routinely runs past 800 characters, so applying this
  // cap to both roles meant a single longer-than-usual answer would get
  // stored client-side, resent as history on the next turn, and reject
  // the *entire* conversation (including a brand new, perfectly valid
  // user message) purely because of something the model itself wrote
  // earlier - not anything the user did wrong.
  if (role === "user" && trimmed.length > MAX_TRIP_QA_MESSAGE_LENGTH) return false;
  return true;
}

export async function POST(request: NextRequest) {
  // `context` is `unknown` here, like `messages` and `voice`. It used to be
  // annotated `TripQAContext` and handed straight to contextBlock, which
  // joins two of its fields and interpolates three more - so
  // {"destinations": "Rome"} was an unhandled 500 from a public endpoint,
  // an array of objects became "[object Object]" in the prompt, and nothing
  // capped its size at all. See lib/tripQAContext.ts.
  let body: { messages?: unknown; context?: unknown; language?: Language; voice?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0 || !rawMessages.every(isValidMessage)) {
    return NextResponse.json(
      {
        detail:
          `Each message needs a role ("user" or "assistant") and content under ${MAX_TRIP_QA_MESSAGE_LENGTH} characters ` +
          `(or a photo). A question may carry at most ${MAX_TRIP_QA_IMAGES_PER_MESSAGE} photo, as raw base64 ` +
          `(${TRIP_QA_IMAGE_MEDIA_TYPES.join(", ")}) under ${Math.round(MAX_TRIP_QA_IMAGE_BYTES / (1024 * 1024))}MB.`,
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
      { detail: `Too many requests - ${rateLimit.reason}. Try again in ~${minutes} minute(s).` },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      }
    );
  }

  // Same session cookie /api/generate reads for quota - here it only gates
  // web_search access, not whether the question can be asked at all (see
  // WEB_SEARCH_MAX_USES's comment above).
  const email = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  let isPaid = false;
  if (email) {
    const user = await getUserRecord(redis, email);
    isPaid = resolvePlan(email, user?.subscriptionStatus ?? null) === "paid";
  }

  // Photo questions are Pro, on the same footing as live web search: an
  // additional capability, never a restriction on the unlimited text Q&A
  // both plans have always had (see the pricing page copy). Checked here
  // and not only in the UI, since the UI's Pro check is a convenience.
  const carriesImages = trimmedMessages.some((m) => (m.images?.length ?? 0) > 0);
  if (carriesImages && !isPaid) {
    return NextResponse.json(
      { detail: "Photo questions are a Pro feature. Text questions stay unlimited on Free." },
      { status: 403 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ detail: "Server is misconfigured (invalid API key)." }, { status: 500 });
  }

  // Only the most recent images survive into the request - see
  // MAX_TRIP_QA_IMAGES_SENT. Earlier photos are dropped from history while
  // their text stays, so a long thread doesn't silently re-upload every
  // photo taken so far on every single turn. Counted from the end, so it's
  // always the newest ones that are kept.
  const imageBudget = new Set<number>();
  let remainingImages = MAX_TRIP_QA_IMAGES_SENT;
  for (let i = trimmedMessages.length - 1; i >= 0 && remainingImages > 0; i--) {
    if ((trimmedMessages[i].images?.length ?? 0) > 0) {
      imageBudget.add(i);
      remainingImages--;
    }
  }

  function toContent(m: TripQAMessage, index: number) {
    const images = imageBudget.has(index) ? (m.images ?? []) : [];
    if (images.length === 0) return m.content;
    // Image before text is the ordering Anthropic documents as producing
    // the better result when a question refers to the picture.
    return [
      ...images.map((img: TripQAImage) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
      })),
      // A photo sent with no typed question still needs a text block, or
      // the model gets an image and no instruction at all.
      { type: "text" as const, text: m.content.trim() || IMPLIED_PHOTO_QUESTION },
    ];
  }

  // Unrecognised or absent -> no voice, which is the plain assistant the
  // feature had before. Never trust the client to hand back a valid one.
  const voice: LocalVoice | null = isLocalVoice(body.voice) ? body.voice : null;

  const client = createAnthropicClient({ apiKey });
  const encoder = new TextEncoder();
  const modelParams = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text:
          (isPaid ? SYSTEM_PROMPT + WEB_SEARCH_ADDENDUM : SYSTEM_PROMPT) +
          PLACE_LOOKUP_ADDENDUM +
          (carriesImages ? PHOTO_ADDENDUM : ""),
      },
      // The voice rides with the trip context rather than in the block
      // above, so the long, static instructions stay byte-identical across
      // requests and keep whatever prompt caching they earn. This block is
      // per-request anyway.
      {
        type: "text" as const,
        text: contextBlock(readTripQAContext(body.context), language) + voiceInstruction(voice),
      },
    ],
    // The place lookup is on both plans; web search stays Pro. Two
    // different things that both answer "check this for me", and only one
    // of them is what the pricing page sells.
    tools: [
      PLACE_LOOKUP_TOOL,
      ...(isPaid
        ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: WEB_SEARCH_MAX_USES }]
        : []),
    ],
  };

  const conversation: Anthropic.MessageParam[] = trimmedMessages.map((m, i) => ({
    role: m.role,
    content: toContent(m, i),
  }));

  /** Runs the model's look_up_place calls and builds the tool_result
   * blocks that answer them.
   *
   * EVERY tool_use block gets a result, including ones this route does
   * not recognise: the API rejects a continuation whose previous
   * assistant turn has an unanswered tool call, so a stray name would
   * otherwise turn a good answer into a failed request. */
  async function answerToolCalls(
    content: Anthropic.ContentBlock[]
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const calls = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    let spent = 0;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name !== PLACE_LOOKUP_TOOL.name) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "Unknown tool." });
        continue;
      }
      const query = typeof (call.input as { query?: unknown })?.query === "string"
        ? ((call.input as { query: string }).query)
        : "";
      if (!placesKey) {
        // Same silent degradation as every other Places-derived signal in
        // the product - the answer is still worth giving without it.
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Lookup for "${query}" could not be completed (not configured). This says nothing about whether the place exists - do not tell the traveler it was not found.`,
        });
        continue;
      }
      if (spent >= MAX_PLACE_LOOKUPS_PER_ROUND) {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Not looked up - too many places requested at once. Answer with the ones you did get back.`,
        });
        continue;
      }
      spent += 1;
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: describePlace(query, await lookUpPlace(placesKey, query)),
      });
    }
    return results;
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentAnyText = false;

      // Rounds, not one call: the model may answer a named-place question
      // by asking for look_up_place first, which means a reply, the
      // lookups, and then the real answer. Text already streamed in an
      // earlier round stays on the page and the next round continues it,
      // which is what the traveler sees as one answer arriving.
      /** Where the lookup loop is up to. The decision that reads it lives
       * in lib/toolRounds.ts, which is where it can be tested - driving a
       * Next route handler is not something this app can do in a suite
       * (same reason as lib/refineSource.ts). */
      let roundState: ToolRoundState = {
        stopReason: null,
        toolRounds: 0,
        refusedFurtherLookups: false,
        maxRounds: MAX_TOOL_ROUNDS,
      };

      for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt++) {
        try {
          while (true) {
            const stream = client.messages.stream({ ...modelParams, messages: conversation });
            stream.on("text", (delta) => {
              sentAnyText = true;
              // The prompt tells the model not to write em dashes and it does
              // anyway, often enough that it's the loudest "an AI wrote this"
              // signal in the answer. Swapped per delta rather than on the
              // finished reply because this response streams; the dash is a
              // single code point, so it can't be split across two deltas and
              // the surrounding spaces are already whatever the model sent.
              controller.enqueue(encoder.encode(delta.replace(/[—–]/g, "-")));
            });

            const finalMessage = await stream.finalMessage();
            // Billed whether or not any text actually streamed, same principle
            // as the worker's onUsage in callModel - record it right away.
            // Inside the round loop, so a tool round is billed too rather
            // than only the round that happens to finish the answer.
            await recordSpend(redis, estimateCostUsd(finalMessage.usage));

            roundState = { ...roundState, stopReason: finalMessage.stop_reason };
            const step = nextToolStep(roundState);
            if (step.action !== "finish") {
              conversation.push({ role: "assistant", content: finalMessage.content });
              if (step.action === "lookups") {
                conversation.push({ role: "user", content: await answerToolCalls(finalMessage.content) });
              } else {
                // Out of rounds with the model still asking. It is told so
                // in the transcript and given one more turn to answer from
                // what it has, which beats closing the stream on a traveler
                // who has seen no reply. nextToolStep allows this once -
                // see toolRounds.ts for why refusing on a loop is a hang.
                conversation.push({
                  role: "user",
                  content: (await answerToolCalls(finalMessage.content)).map((r) => ({
                    ...r,
                    content: "No more lookups available for this question. Answer with what you have.",
                  })),
                });
                console.warn(`[trip-questions] hit the ${MAX_TOOL_ROUNDS}-round lookup ceiling`);
              }
              roundState = applyToolStep(roundState, step);
              continue;
            }
            if (finalMessage.stop_reason === "tool_use") {
              console.warn("[trip-questions] model kept asking for lookups after being refused - answering without");
            }

            // A truncated answer used to be indistinguishable from a finished
            // one: stop_reason was never read, so the traveler got a sentence
            // that stopped mid-word and no log line existed to say why.
            if (finalMessage.stop_reason === "max_tokens") {
              console.warn(
                `[trip-questions] answer hit the ${MAX_TOKENS}-token ceiling and was truncated`
              );
              if (sentAnyText) controller.enqueue(encoder.encode(TRUNCATED_SUFFIX[language]));
            }

            if (!sentAnyText) {
              // A well-formed response with no text content is rare but not
              // impossible - same fallback as a hard failure, since an empty
              // reply is just as unhelpful to the traveler either way.
              controller.enqueue(encoder.encode(FALLBACK_REPLY[language]));
            }
            controller.close();
            return;
          }
        } catch (e) {
          console.error(`[trip-questions] model attempt ${attempt} failed:`, e);
          // No point spending a second call on a credential that cannot
          // work, and no point telling the traveler to try again.
          if (isConfigurationError(e)) {
            console.error(
              "[trip-questions] THIS IS A CONFIGURATION FAILURE, not an overload - " +
                "check ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID on this deployment"
            );
            if (!sentAnyText) controller.enqueue(encoder.encode(MISCONFIGURED_REPLY[language]));
            controller.close();
            return;
          }
          if (sentAnyText) {
            // Partial text already reached the client - retrying now would
            // just glue a second, unrelated attempt onto a half-finished
            // answer, which reads far worse than just stopping here.
            controller.close();
            return;
          }
          if (attempt >= MAX_MODEL_ATTEMPTS) {
            controller.enqueue(encoder.encode(FALLBACK_REPLY[language]));
            controller.close();
            return;
          }
          // Otherwise loop straight into the next attempt - no delay, since
          // the point is to still feel instant even when the first attempt
          // hits a transient overload.
        }
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
