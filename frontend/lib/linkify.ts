// Turns an Ask a Local answer into renderable segments, so a place the
// local mentions is one tap from a map and a source it cites is one tap
// from the page.
//
// WHY THIS IS NOT dangerouslySetInnerHTML
//
// This text comes from a model, and on the photo path it is partly a
// reading of an image the traveler supplied. Handing that to innerHTML
// would mean any angle bracket the model wrote became markup, which is
// the whole XSS story in one sentence. Segments keep React's escaping:
// text stays text, and the only anchors that exist are ones this file
// built from a URL it validated itself.
//
// WHY PLACE NAMES ARE NOT MODEL-WRITTEN URLs
//
// The obvious way to get a map link is to ask the model for one. That is
// wrong here for the same reason the itinerary never trusts a
// self-reported price: a Maps URL carries a place id or a CID, and a
// hallucinated one does not fail loudly, it resolves confidently to the
// wrong restaurant. This product already solved this shape twice - the
// flight link is a deterministic Google Flights SEARCH url built from the
// brief, and an itinerary item's map link is built from a place id that
// Places actually returned.
//
// So the model marks a place as [[Roscioli]] and this file builds the
// search URL. A search for a name that exists lands on it; a search for a
// name the model invented lands on "no results", which is the honest
// outcome and visibly different from being sent to the wrong door.

/** One piece of an answer: either plain text or something tappable. */
export type LinkSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

/** Matches, in one pass: a [[marked place]], or a bare URL.
 *
 * Only http/https and www are matched, which is also the security
 * boundary - "javascript:" and "data:" cannot be produced by this pattern
 * at all, so there is no denylist to keep up to date. */
const TOKEN = /\[\[([^[\]\n]{0,80})\]\]|((?:https?:\/\/|www\.)[^\s<>"'`]+)/g;

/** Punctuation that ends a sentence rather than a URL. "See maps.google.com."
 * should not link the full stop. */
const TRAILING = /[.,;:!?]+$/;

/** Trims what a sentence put after a URL without trimming what the URL
 * needs. The paren case is the one that bites: Wikipedia puts brackets in
 * real paths ("/wiki/Rome_(mythology)"), so a closing paren only counts as
 * punctuation when the URL does not open one itself. */
function trimUrlTail(raw: string): string {
  let url = raw.replace(TRAILING, "");
  while (url.endsWith(")") && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) {
    url = url.slice(0, -1);
  }
  while (url.endsWith("]") && (url.match(/\[/g) ?? []).length < (url.match(/\]/g) ?? []).length) {
    url = url.slice(0, -1);
  }
  return url.replace(TRAILING, "");
}

/** A real, absolute http(s) URL, or null. Parsing rather than
 * pattern-matching: URL() is the thing that actually decides what a
 * browser will do with this string. */
function safeHref(raw: string): string | null {
  const candidate = raw.startsWith("www.") ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** How a long URL reads in a chat bubble. The full thing would wrap over
 * four lines and tell the traveler nothing; the host and a marker say
 * where it goes. */
const MAX_LABEL = 42;

function labelFor(url: string): string {
  if (url.length <= MAX_LABEL) return url.replace(/^https?:\/\//, "");
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}/...`;
  } catch {
    return url.slice(0, MAX_LABEL) + "...";
  }
}

/** A Google Maps search for a place, in the documented `api=1` form that
 * opens the Maps app on a phone and the site on a desktop.
 *
 * The trip's city is appended when known: "Roscioli" is ambiguous
 * worldwide and unambiguous in Rome, and the traveler asking is
 * demonstrably in one of those two situations. */
export function mapsSearchUrl(place: string, near?: string): string {
  const query = near && !place.toLowerCase().includes(near.toLowerCase()) ? `${place} ${near}` : place;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export interface LinkifyOptions {
  /** The trip's city, to disambiguate a marked place name. */
  near?: string;
  /** True while the answer is still arriving. A URL that runs to the very
   * end of the text may be half-delivered ("https://maps.goo"), and a link
   * that is wrong for one chunk is a link a traveler can tap in that
   * chunk, so it stays text until the rest lands. */
  streaming?: boolean;
}

/** Splits an answer into text and links. Never returns markup, and never
 * returns an href it did not build or validate itself. */
export function linkifyAnswer(input: string, options: LinkifyOptions = {}): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;

  const pushText = (raw: string) => {
    // The prompt convention must never reach the traveler as punctuation.
    // A well-formed marker was consumed above; what can be left is the
    // malformed cases - an unmatched half, or the outer pair of a nested
    // "[[a [[b]] c]]" - and "[[a b c]]" on screen is the model's internal
    // notation leaking into a sentence someone is trying to read.
    const text = raw.replace(/\[\[|\]\]/g, "");
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += text;
    else segments.push({ kind: "text", text });
  };

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(input); match !== null; match = TOKEN.exec(input)) {
    const [whole, place, rawUrl] = match;
    pushText(input.slice(cursor, match.index));
    cursor = match.index + whole.length;

    if (place !== undefined) {
      const name = place.trim();
      // An empty marker is not a place. Render nothing rather than a link
      // to a search for "".
      if (!name) continue;
      segments.push({ kind: "link", text: name, href: mapsSearchUrl(name, options.near) });
      continue;
    }

    const url = trimUrlTail(rawUrl);
    const tail = rawUrl.slice(url.length);
    const runsToEnd = cursor >= input.length && !tail;
    const href = safeHref(url);

    if (!href || (options.streaming && runsToEnd)) {
      // Unparseable, or still arriving: leave it exactly as written.
      pushText(rawUrl);
      continue;
    }
    segments.push({ kind: "link", text: labelFor(href), href });
    pushText(tail);
  }

  let tail = input.slice(cursor);
  // A marker can be split across two streamed chunks ("...try [[Rosc" then
  // "ioli]] for lunch"), unlike the em dash the route swaps per delta,
  // which is a single code point. The accumulated text is always whole by
  // the end, so this only hides one frame of raw brackets - but that frame
  // is visible, and "[[Rosc" is a strange thing to read.
  if (options.streaming) {
    const unclosed = tail.lastIndexOf("[[");
    if (unclosed !== -1 && !tail.slice(unclosed).includes("]]")) {
      tail = tail.slice(0, unclosed);
    }
  }
  pushText(tail);
  return segments;
}
