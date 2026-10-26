// Whether a trip delivers what the traveller asked for by name.
//
// Shared by the quality gate (engine/quality.ts), which reports a must-see
// that appears nowhere, and venue verification (engine/venueVerification.ts),
// which must never quietly delete one: a must-see is the traveller's own
// requirement, and dropping it because it is shut that day turns "you
// asked for the Vatican" into five empty hours with no explanation.
//
// Run: npm run test:quality (covered there)

import type { ItineraryItem } from "../types";

/** Whether `haystack` refers to `wanted`, loosely enough to survive the
 * difference between how a traveler types a place and how an itinerary
 * writes it - "colosseum" against "Colosseum, Roman Forum and Palatine
 * Hill". Every word of the request that carries meaning has to appear;
 * short connectives are dropped so "the Trevi Fountain" and "Trevi
 * Fountain" match. */
const REQUEST_STOPWORDS = new Set([
  // Filtering by length alone kept "the", which made the check demand that
  // an itinerary contain the word "the" before it would accept that "the
  // Colosseum" had been included. Three letters is not the same as
  // meaningless, so the meaningless ones are named.
  "the", "and", "for", "with", "from", "into", "near", "our", "your", "its",
  "see", "visit", "visiting", "tour", "trip", "day", "days", "some", "any",
  "want", "would", "like", "must", "really", "definitely", "maybe",
  // Booking logistics. A traveler who writes "X (reservation at 8 pm)" is
  // telling us about X; the itinerary will say "Dinner at X", not repeat
  // the word "reservation".
  "reservation", "reservations", "reserved", "booked", "booking", "bookings", "table", "tickets",
]);

// How a must-see written as a wish starts, in English and Bulgarian:
// "wants to go to", "would like to see the", "искам да отида до". Only
// with a going or seeing verb: "want to rent a car" and "искам да карам
// ски" are requests about the trip, not places to look for.
const LEAD_IN =
  /^(?:(?:i|we|they|he|she|my \w+)\s+)?(?:(?:really|definitely)\s+)?(?:wants?|would like|'d like|likes?|needs?|hopes?|hoping)\s+(?:to\s+)?(?:go\s+(?:to\s+)?|see\s+|visit\s+|eat\s+at\s+)(?:the\s+)?|^(?:искам|искаме|бих искал[а]?|бихме искали)\s+(?:да\s+)?(?:отида|отидем|видя|видим|посетя|посетим)\s*(?:до|в|във|на)?\s*/iu;

/** The place a must-see names, without the note around it.
 *
 * A real Rome run asked for "Il Paiolo Magico (reservation at 8 pm on the
 * 6th)", got a dinner at Il Paiolo Magico - the trip summary and the
 * budget both mention it - and the gate reported it dropped: of the words
 * left after filtering (paiolo, magico, reservation, 6th) the item had two
 * and three were needed. A bracketed note, a time or a date is the
 * traveler telling us WHEN, which is the prompt's job; whether the PLACE
 * is in the plan is this check's. */
function requestedPlace(wanted: string): string {
  const outside = wanted.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim();
  // Only when something is left: "(the old harbour)" alone is all there is.
  return outside.replace(/[^\p{L}\p{N}]/gu, "").length > 0 ? outside : wanted;
}

export function mentions(haystack: string, wanted: string): boolean {
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      // \p{L}\p{N}, not [a-z0-9]: the ASCII class replaced every Cyrillic,
      // Greek and CJK character with a space, so a Bulgarian must-see
      // normalized to nothing and the `words.length === 0` guard below
      // reported it as DELIVERED on an itinerary that never mentioned it.
      // The check the comment above calls the one this product can least
      // afford to get wrong was inert in the app's own second language.
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !REQUEST_STOPWORDS.has(w));
  // Times and dates ("8pm", "20:00" -> "20" "00", "6th", "2026") are when,
  // not what: any token carrying a digit is dropped from what is looked
  // for. Kept in the haystack, where they do no harm.
  const words = normalize(requestedPlace(wanted)).filter((w) => !/\p{N}/u.test(w));
  // Still true when there is nothing to look for - a must-see of "!!!" is
  // not a dropped requirement - but this is now reached only for input
  // that genuinely carries no letters or digits in any script.
  if (words.length === 0) return true;
  const hay = new Set(normalize(haystack));
  const matched = words.filter((w) => hay.has(w)).length;

  // Every word, for one- and two-word requests - those are proper nouns and
  // dropping half of "Vatican Museums" would let any museum satisfy it.
  // For longer phrases, allow one word to go missing: people write
  // must-sees as descriptions ("Trevi Fountain at night", "the Colosseum
  // underground tour") and an itinerary that delivers the place without the
  // adjective has not dropped anything. Demanding all of it would report a
  // silent drop that did not happen, which is the failure mode this check
  // can least afford - a false alarm here trains you to ignore it.
  const needed = words.length <= 2 ? words.length : words.length - 1;
  return matched >= needed;
}

/** The places in one must-see line, without the requests around them.
 *
 * People type must-sees as sentences. A real Friedrichshafen run asked for
 * "Neuschwanstein Castle and also want to rent a car", got a day driving
 * to Neuschwanstein Castle in a rental car, and the gate reported the
 * whole line as dropped: "want to rent a car" is a request, not a place,
 * and its words are not in any item. So a line is split where people join
 * separate things ("also", "plus", "as well as", ";", "и също"), and a
 * part that reads as a request ("want to...", "need a...", "rent...")
 * is left to the prompt, which already has it, rather than looked for as
 * a place. Plain "and" is NOT a split: "Colosseum and Roman Forum" is how
 * one ticket is written. */
export function requestedPlaces(wanted: string): string[] {
  const parts = wanted
    // Letter lookarounds, not \b: \b only knows Latin letters, so it
    // never matched "също" in a Bulgarian line.
    .split(/\s*(?:;|(?<!\p{L})(?:and also|also|plus|as well as|и също|също|както и)(?!\p{L}))\s*/iu)
    .map((part) => part.replace(/^(?:and|и)\s+|\s+(?:and|и)$/giu, "").trim())
    .filter((part) => part.replace(/[^\p{L}\p{N}]/gu, "").length > 0);
  const request =
    /^(?:i\s+|we\s+|i'd\s+|we'd\s+)?(?:want|need|would like|like to|rent|hire|book|get|have|take|try|go|do|make|искам|искаме|бих|наем|да\s)/iu;
  // "wants to go to Vatican" is a place wearing a request: the lead-in is
  // taken off and what is left is the place. A real Rome run reported the
  // Vatican as dropped because the whole line read as a request and was
  // then looked for word for word, "wants" included. What is left only
  // counts as a place if it is not itself a request ("want to rent a car"
  // leaves "rent a car", which still is one).
  const places = parts
    .map((part) => {
      const rest = part.replace(LEAD_IN, "").trim();
      return rest !== part && rest.replace(/[^\p{L}]/gu, "").length > 0 && !request.test(rest) ? rest : part;
    })
    .filter((part) => !request.test(part));
  // Never nothing: a line that is only a request is still checked as it
  // was, so this can make the check quieter only where it was wrong.
  return places.length > 0 ? places : [wanted];
}

/** Whether this item is one of the traveller's must-sees. */
export function isMustSeeItem(item: Pick<ItineraryItem, "title" | "venue_name" | "location">, mustSee: string[]): boolean {
  const text = [item.title, item.venue_name, item.location].filter((v): v is string => typeof v === "string").join(" ");
  return mustSee.flatMap(requestedPlaces).some((wanted) => mentions(text, wanted));
}
