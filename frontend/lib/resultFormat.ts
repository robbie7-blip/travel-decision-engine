// Pure text/date formatting used by the itinerary result page.
//
// These two functions lived inside components/ItineraryResult.tsx, which is
// a "use client" component full of JSX - so nothing could import them, and
// nothing tested them. Both were wrong in ways that only show up on a
// finished, paid-for trip: one rendered every Bulgarian budget explanation
// as a single run-on bullet, the other could put the wrong day's opening
// hours under a green "open on this day" badge, and one of them threw
// during render (blanking the whole itinerary) on a field nothing
// guarantees. A module with no React in it is one that can be tested.
//
// Run: npm run test:result-format

/** Splits the model's free-text budget reasoning into sentences for display
 * as bullet points, since the reasoning itself is unstructured prose (no
 * schema field breaks it into a list) - a period/!/? followed by whitespace
 * and then a capital letter or a currency symbol is a safe-enough split
 * point given this app's plain, short-sentence prompt style (see WRITING
 * STYLE in the system prompt). Worst case a sentence splits oddly; the
 * underlying text is never altered or dropped either way.
 *
 * `\p{Lu}` rather than `[A-Z]`: the trip's response language follows the
 * brief, so half the reasoning this ever sees is Bulgarian, and Cyrillic
 * capitals are not in A-Z. Every Bulgarian itinerary was rendering its
 * whole budget explanation as one run-on bullet, which read as a model
 * quirk rather than as a regex that only knew one alphabet.
 *
 * Takes `string | null | undefined` because nothing upstream guarantees
 * `reasoning` is present - no quality check covers it, no repair fills it -
 * and reading `.split` off undefined during render throws inside the client
 * component, which blanks an itinerary that generated fine and was paid
 * for. */
export function splitIntoSentences(text: string | null | undefined): string[] {
  if (typeof text !== "string" || !text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[\p{Lu}€$£])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** English weekday names, indexed the way Date.getUTCDay() reports them
 * (0 = Sunday) - deliberately hard-coded rather than derived from
 * toLocaleDateString, because these are matched against Google's own text
 * and so have to be in Google's language, not the viewer's. A Bulgarian
 * browser asked for a weekday name gives "вторник", which matches nothing
 * in a response that says "Tuesday". (The worker sends no languageCode on
 * the Places request - see venueVerification.ts - so the descriptions come
 * back in the API's default English.) */
const GOOGLE_WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** The published hours for `isoDate`, out of Google's weekdayDescriptions.
 *
 * Picked by MATCHING THE WEEKDAY NAME the line carries, not by indexing.
 * The previous version computed `(getUTCDay() + 6) % 7` on the assumption
 * that the array is Monday-first - which the Places API does not guarantee,
 * documents only as "one string for each day of the week", and returns
 * Sunday-first in the legacy API. When that assumption is wrong the line is
 * off by one and the page shows a DIFFERENT DAY'S HOURS underneath a green
 * badge reading "open on this day" - the one signal on the page that is
 * about whether the traveler can actually get in.
 *
 * The index arithmetic survives as a fallback for the case a name match
 * can't cover (Google returning localized descriptions after all), where an
 * ordering guess still beats showing nothing.
 *
 * Returns just the hours ("11:00 AM - 10:00 PM"), or null when there is
 * nothing trustworthy to show. */
export function hoursLineFor(descriptions: string[] | undefined | null, isoDate: string): string | null {
  if (!Array.isArray(descriptions) || descriptions.length === 0) return null;
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  const weekday = new Date(parsed).getUTCDay();
  const name = GOOGLE_WEEKDAY_NAMES[weekday];

  let line = descriptions.find((d) => typeof d === "string" && d.trim().toLowerCase().startsWith(name));
  if (line === undefined) {
    line = descriptions[(weekday + 6) % 7];
  }
  if (typeof line !== "string" || !line.trim()) return null;

  // "Tuesday: 11:00 AM - 10:00 PM" -> just the hours. Only the FIRST colon
  // separates the label from the hours; the ones inside "11:00" have to
  // survive, which is why this is indexOf and not a split.
  const colon = line.indexOf(":");
  const hours = (colon === -1 ? line : line.slice(colon + 1)).trim();
  return hours || null;
}
