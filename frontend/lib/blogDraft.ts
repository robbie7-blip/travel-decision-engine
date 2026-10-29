// A first draft of a blog post, written by Claude from a topic, for the
// admin to check, edit and publish (/admin/blog). Nothing is published by
// this: a draft is only ever filled into the editor.
//
// News posts use web search and must name what they are based on; the
// sources come back with the draft and are shown under the post. Stories
// and destination pieces are written from what the model knows, and say
// less rather than guess.
//
// The cover photo comes from Pexels when PEXELS_API_KEY is set: a real
// photo with its real photographer's name and page, as Pexels returns
// them. Without the key the editor asks for a photo to be chosen by hand.
//
// Run: npm run test:blog-draft (the parsing; the model call is not tested)

import type Anthropic from "@anthropic-ai/sdk";
import { blogSlug, type BlogLanguage, type BlogSource } from "./blogQuery";

export type DraftKind = "news" | "destination" | "story" | "tip" | "mistakes";

/** The kinds whose facts must come from sources found on the web, listed
 * under the post. */
export const SOURCED_KINDS: ReadonlySet<DraftKind> = new Set(["news", "tip", "mistakes"]);

export interface BlogDraft {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  destinations: string[];
  sources: BlogSource[];
  imageQuery: string;
}

export const DRAFT_MODEL = "claude-sonnet-5";

const KIND_BRIEF: Record<DraftKind, string> = {
  news: `A NEWS post: something that is new or changing in travel right now (a new route, a rule, an opening, a festival, a closure). Use web search to find current, reliable reporting. Every fact must come from a source you found; list those sources. If you cannot confirm something, leave it out.`,
  destination: `A DESTINATION post: one place worth the trip that most travellers overlook, written so a reader can picture going. Concrete specifics (neighbourhoods, a dish, a walk, the best season), not generic praise. Leave out prices, opening hours and other details that change, unless you are sure.`,
  tip: `A TRAVEL TIP post: one practical trick or rule that saves European travellers money, time or hassle (airport security, airline bag rules, rail tickets, passenger rights, entry rules, card and roaming fees). The kind of thing people save and send to a friend before a trip. Use web search to confirm it from official or reliable sources (the airline, airport, rail company, EU or government page); list those sources. Say exactly who and where it applies to, and what to check before relying on it. If you cannot confirm the trick, write about a related one you can confirm instead; never present a rumour as fact.`,
  mistakes: `A MISTAKES post: the mistakes visitors to one place most often make, and what to do instead (tickets, scams, transport, etiquette, timing, money). Concrete and useful, never sneering at travellers or locals. Use web search to confirm any rule, fine, fee or official advice from reliable sources and list them; leave out anything you cannot confirm.`,
  story: `A STORY post: a fascinating, true story behind a place (history, a legend, an odd fact) told so it is hard to stop reading. Only what is well established; where something is legend rather than fact, say so.`,
};

export function draftSystemPrompt(language: BlogLanguage): string {
  const lang =
    language === "bg"
      ? `Write in natural Bulgarian. Address the reader informally ("ти"), and phrase sentences so they do not need a gendered past participle for the reader.`
      : `Write in natural British English.`;
  return `You write for the blog of decide, an AI travel planner (yourdecide.com). The posts are shared on Instagram and Pinterest, so they must be genuinely interesting, specific and accurate: the kind of thing someone saves for later.

${lang}

Style:
- A headline that makes people curious enough to click, and is completely true: no exaggeration, and nothing the post does not deliver ("The airport rule most Europeans still get wrong" is fine if the post shows it). It must be grammatical, plain English a native speaker would say out loud: a full phrase or sentence, not a clipped or puzzling one (not "The Amsterdam the canal boats never reach", but "The side of Amsterdam the canal boats never reach").
- 600 to 900 words. Short paragraphs. Two to four "## " section headings. One list where it helps.
- Never use em dashes or en dashes: use commas, colons or full stops.
- No filler ("nestled", "hidden gem", "bucket list", "a feast for the senses").
- Do not sell decide in the text; the page adds its own button. One natural closing line about planning a visit is fine.

Accuracy matters more than anything: never invent facts, numbers, dates, quotes or sources.

Reply with ONLY a JSON object, no other text:
{"title": "...", "excerpt": "one or two sentences for the post list and search results", "body": "the article in Markdown, using only ## and ### headings, paragraphs, - lists, **bold**, *italic* and [links](https://...)", "destinations": ["the main place, as a traveller would type it, e.g. Lisbon"], "sources": [{"title": "...", "url": "https://..."}], "image_query": "2 to 4 words to search a photo library for a cover, in English"}`;
}

export function draftUserPrompt(kind: DraftKind, topic: string, today: string): string {
  return `${KIND_BRIEF[kind]}\n\nToday is ${today}.\n\nTopic: ${topic}`;
}

/** The JSON object in a model reply, or null. Models sometimes put real
 * line breaks or tabs inside a string (the article body, mostly), which is
 * not valid JSON and used to throw the whole post away; those are escaped
 * before parsing. */
export function readJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // Escape control characters inside strings, and try once more.
  }
  let fixed = "";
  let inString = false;
  let escaped = false;
  for (const ch of slice) {
    if (inString && !escaped && ch === "\n") fixed += "\\n";
    else if (inString && !escaped && ch === "\r") fixed += "\\r";
    else if (inString && !escaped && ch === "\t") fixed += "\\t";
    else fixed += ch;
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = inString;
    else if (ch === '"') inString = !inString;
  }
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

/** The model's reply as a draft, or null when it is not one. Lenient about
 * text around the JSON; strict about what the JSON holds. */
export function parseDraft(text: string): BlogDraft | null {
  const raw = readJsonObject(text);
  if (!raw) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(raw.title);
  const body = str(raw.body);
  if (!title || body.length < 200) return null;
  const sources: BlogSource[] = [];
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    const url = str((s as Record<string, unknown>)?.url);
    if (/^https?:\/\//.test(url)) sources.push({ title: str((s as Record<string, unknown>)?.title) || url, url });
  }
  return {
    title: title.slice(0, 160),
    slug: blogSlug(title),
    excerpt: str(raw.excerpt).slice(0, 400),
    // The house rule, enforced rather than requested: no em or en dashes.
    body: body.replace(/\s*[\u2013\u2014]\s*/g, ", "),
    destinations: (Array.isArray(raw.destinations) ? raw.destinations : []).map(str).filter(Boolean).slice(0, 6),
    sources: sources.slice(0, 12),
    imageQuery: str(raw.image_query).slice(0, 80),
  };
}

/** Asks Claude for the draft. Sourced kinds may search the web (a few searches, so
 * the request fits the function's time limit); the rest do not need to. */
export async function writeDraft(
  client: Anthropic,
  input: { kind: DraftKind; topic: string; language: BlogLanguage; today: string }
): Promise<BlogDraft | null> {
  return (await writeDraftWithReason(client, input)).draft;
}

/** writeDraft, saying why when there is no draft, for the owner's email. */
export async function writeDraftWithReason(
  client: Anthropic,
  input: { kind: DraftKind; topic: string; language: BlogLanguage; today: string }
): Promise<{ draft: BlogDraft | null; problem: string }> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: draftUserPrompt(input.kind, input.topic, input.today) }];
  const tools = SOURCED_KINDS.has(input.kind) ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 3 }] : undefined;
  let text = "";
  let stop: string | null = null;
  // A response with server-side tools can pause mid-turn; it is continued
  // by sending it back, a bounded number of times.
  for (let round = 0; round < 3; round++) {
    const response = await client.messages.create({
      model: DRAFT_MODEL,
      // The model thinks before it writes, and the thinking counts against
      // this. At 4096 a long story ran out partway through the article and
      // came back as half a JSON object (an Athens story, October 2026).
      max_tokens: 16000,
      system: draftSystemPrompt(input.language),
      messages,
      ...(tools ? { tools } : {}),
    });
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    stop = response.stop_reason;
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  const draft = parseDraft(text);
  if (draft) return { draft, problem: "" };
  const problem =
    stop === "max_tokens"
      ? "it ran out of room before finishing the article"
      : stop === "refusal"
        ? "the model declined the topic"
        : !text.trim()
          ? "it came back empty"
          : readJsonObject(text)
            ? "the article was missing or too short"
            : "it was not in the expected format";
  return { draft: null, problem };
}

export const REVIEW_MODEL = "claude-haiku-5-5";

export interface DraftReview {
  title: string;
  excerpt: string;
  body: string;
  /** False when the editor found something it could not fix by editing,
   * or a claim that looks wrong: the post then waits as a draft. */
  publishable: boolean;
  issues: string[];
}

export function reviewSystemPrompt(language: BlogLanguage): string {
  const lang = language === "bg" ? "Bulgarian" : "British English";
  return `You are a meticulous copy editor for a travel blog written in ${lang}. You are given a post that is about to be published.

Fix, with the lightest touch that works:
- grammar, spelling, punctuation and agreement;
- awkward, clipped or unnatural phrasing, including in the headline and the section headings. The headline must read as plain, grammatical ${lang} a native speaker would say out loud.

Do not:
- add, remove or change any fact, name, number, date or claim;
- change the meaning, the tone or the order of the sections;
- add, remove or change links, or the number of "## " section headings;
- use em dashes or en dashes.

Set "publishable" to false only if something cannot be fixed by light editing, or a claim reads as likely untrue. List what you changed, and anything you doubt, in "issues" (short phrases).

Reply with ONLY a JSON object, no other text:
{"title": "...", "excerpt": "...", "body": "the full corrected article in the same Markdown", "publishable": true, "issues": ["..."]}`;
}

function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).sort();
}

function headingCount(markdown: string): number {
  return markdown.split("\n").filter((line) => /^##\s/.test(line)).length;
}

/** The editor's reply, or null when it is not usable: not JSON, or an edit
 * that went further than copy editing (the length moved a lot, a section
 * heading or a link appeared or went). A null review means the post is not
 * published unattended. */
export function parseReview(text: string, original: Pick<BlogDraft, "body">): DraftReview | null {
  const raw = readJsonObject(text);
  if (!raw) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const undash = (v: string) => v.replace(/\s*[\u2013\u2014]\s*/g, ", ");
  const title = undash(str(raw.title));
  const body = undash(str(raw.body));
  if (!title || !body) return null;
  const ratio = body.length / Math.max(1, original.body.length);
  if (ratio < 0.8 || ratio > 1.2) return null;
  if (headingCount(body) !== headingCount(original.body)) return null;
  if (links(body).join(" ") !== links(original.body).join(" ")) return null;
  return {
    title: title.slice(0, 160),
    excerpt: undash(str(raw.excerpt)).slice(0, 400),
    body,
    publishable: raw.publishable === true,
    issues: (Array.isArray(raw.issues) ? raw.issues : []).map(str).filter(Boolean).slice(0, 12),
  };
}

/** A copy edit of the draft by a second, fast model, within `timeoutMs`.
 * Null when it could not be done in time or came back unusable. */
export async function reviewDraft(client: Anthropic, draft: BlogDraft, language: BlogLanguage, timeoutMs: number): Promise<DraftReview | null> {
  try {
    const response = await client.messages.create(
      {
        model: REVIEW_MODEL,
        max_tokens: 16000,
        output_config: { effort: "low" },
        system: reviewSystemPrompt(language),
        messages: [{ role: "user", content: JSON.stringify({ title: draft.title, excerpt: draft.excerpt, body: draft.body }) }],
      },
      { timeout: timeoutMs, maxRetries: 0 }
    );
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseReview(text, draft);
  } catch {
    return null;
  }
}

export interface CoverPhoto {
  url: string;
  alt: string;
  credit: string;
  creditUrl: string;
}

/** A landscape photo for `query` from Pexels, with its photographer as
 * Pexels names them - or null (no key, nothing found, Pexels down). */
export async function findCoverPhoto(query: string, apiKey: string | undefined): Promise<CoverPhoto | null> {
  if (!apiKey || !query) return null;
  try {
    const res = await fetch(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation: "landscape", per_page: "5" })}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      photos?: { src?: { original?: string }; alt?: string; photographer?: string; photographer_url?: string; width?: number; height?: number }[];
    };
    const photo = (data.photos ?? []).find((p) => p.src?.original && p.photographer && (p.width ?? 0) >= 1600);
    if (!photo?.src?.original || !photo.photographer) return null;
    const original = new URL(photo.src.original);
    if (original.hostname !== "images.pexels.com") return null;
    return {
      url: `${original.origin}${original.pathname}`,
      alt: (photo.alt ?? "").slice(0, 200),
      credit: `${photo.photographer} on Pexels`,
      creditUrl: photo.photographer_url ?? "https://www.pexels.com",
    };
  } catch {
    return null;
  }
}
