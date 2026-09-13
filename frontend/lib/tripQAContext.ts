// The trip context Ask a Local puts in its system prompt.
//
// /api/trip-questions is a public POST, and it read `context` off the JSON
// body with a TYPE ANNOTATION and nothing else:
//
//   let body: { messages?: unknown; context?: TripQAContext; ... }
//
// `messages` is `unknown` and properly validated a few lines later, images
// and all. `context` is annotated as the thing it is hoped to be and handed
// straight to contextBlock, which does `.join(", ")` on two of its fields
// and interpolates three more. Measured against the real function:
//
//   {"destinations": "Rome"}          -> THREW "destinations.join is not a
//                                       function", i.e. an unhandled 500
//                                       from a public endpoint
//   {"interests": "food"}             -> threw the same way
//   {"destinations": [{"city":"Rome"}]} -> "Destination(s): [object Object]"
//                                       in the prompt
//   {"party_composition": {"n": 2}}   -> "Travelers: [object Object]"
//   {"destinations": ["x".repeat(200000)]} -> a 200,050-character context
//                                       block, from one field of five
//
// The last one is the expensive one. Every other input to this route is
// capped - messages by MAX_TRIP_QA_MESSAGE_LENGTH, history by
// MAX_TRIP_QA_HISTORY, photos by count and by bytes - and the comment on
// MAX_LIST_ENTRY_CHARS in validation.ts spells out exactly this reasoning
// for the brief's own lists ("the same prompt-bloat, and the same injection
// surface"). The context had no cap of any kind, so a caller could push most
// of a request body into a Sonnet prompt and bill it against the shared
// daily budget every other traveller draws from.
//
// The caps here are the BRIEF's caps, imported rather than re-chosen,
// because this context is built from a brief that already passed them (see
// TripView -> TripQA). A context field that is legitimate in a brief has to
// survive here, or the validation would be a quality regression dressed as a
// fix.
//
// Run: npm run test:trip-qa-context

import type { Language } from "./types";
import type { TripQAContext } from "./tripQA";
import { MAX_LIST_ENTRIES, MAX_LIST_ENTRY_CHARS, MAX_TEXT_CHARS } from "./validation";

/** A free-text list, same shape as validation.ts's cleanList: strings only,
 * trimmed, each capped, blanks dropped, count capped. */
function cleanList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, MAX_LIST_ENTRY_CHARS))
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_LIST_ENTRIES);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, MAX_TEXT_CHARS) || undefined;
}

/** A YYYY-MM-DD date, or undefined.
 *
 * Shape-checked rather than passed through, because these two are rendered
 * as a sentence of fact to the model - "Dates: X to Y" - and a caller could
 * otherwise write the whole clause. Not parsed for validity: an impossible
 * date like 2027-02-31 is a wrong fact and the model can be wrong about it
 * harmlessly, whereas an arbitrary string is a free line of prompt. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(value: unknown): string | undefined {
  return typeof value === "string" && DATE_RE.test(value) ? value : undefined;
}

/** The context, narrowed to what it claims to be, or undefined.
 *
 * Dropped field by field rather than refused as a whole: this is decoration
 * on a question the traveller has already typed, and answering without the
 * trip context is a slightly worse answer, while a 400 is no answer at all.
 * Nothing here is load-bearing enough to be worth failing the request for. */
export function readTripQAContext(value: unknown): TripQAContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;

  const context: TripQAContext = {
    destinations: cleanList(raw.destinations),
    start_date: cleanDate(raw.start_date),
    end_date: cleanDate(raw.end_date),
    party_composition: cleanText(raw.party_composition),
    interests: cleanList(raw.interests),
  };

  // Every field gone means there was no usable context, and `undefined` is
  // what contextBlock already handles as "no trip attached".
  const hasAnything = Object.values(context).some((field) => field !== undefined);
  return hasAnything ? context : undefined;
}

function languageLabel(language: Language): string {
  return language === "bg" ? "Bulgarian (български)" : "English";
}

/** The context as the model reads it.
 *
 * Moved here from the route so the validator above and its one consumer are
 * tested as a pair. Reproducing it in the suite instead would have been the
 * same two functions drifting apart at leisure - and this one's exact
 * behaviour IS the reason the validator is shaped the way it is: `.join` on
 * two fields, raw interpolation on three, and `?.length` guards that are
 * truthy for a string. */
export function contextBlock(context: TripQAContext | undefined, language: Language): string {
  const lines: string[] = [];
  if (context?.destinations?.length) lines.push(`Destination(s): ${context.destinations.join(", ")}`);
  if (context?.start_date && context?.end_date) lines.push(`Dates: ${context.start_date} to ${context.end_date}`);
  if (context?.party_composition) lines.push(`Travelers: ${context.party_composition}`);
  if (context?.interests?.length) lines.push(`Interests: ${context.interests.join(", ")}`);
  lines.push(`Respond in ${languageLabel(language)}.`);
  return `Trip context:\n${lines.join("\n")}`;
}
