// The times behind the arrival/departure time fields.
//
// These were free-text inputs placeholdered "e.g. 8pm, or 'evening'", which
// is a lot of trust to put in typing when the value ends up in a prompt as
// "arriving around <whatever they wrote>". A picker is easier and it is also
// more accurate: "8pm" and "20:00" and "8 PM" are three strings for one
// time, and only one of them reads cleanly in the Bulgarian prompt.
//
// WHY THE VAGUE OPTIONS SURVIVE. A strict clock would be a capability loss.
// TripBriefInput's own comment says arrival_time is "a free-text time (e.g.
// '20:00' or 'evening')", the prompt handles both, and "evening" is the
// honest answer when somebody has a booking they have not looked at closely.
// So the list is 48 half-hour slots plus five times of day, and the field
// still shows any value already in it - a time written before this existed,
// or one a flight import wrote, is displayed as-is rather than silently
// dropped for not being on the list.
//
// THE VALUE IS ALWAYS CANONICAL. "20:00" for a clock time, an English word
// for a time of day, whatever the interface language - same rule as
// lib/cityOptions.ts and destinationCityNamesBg.ts. The prompt that consumes
// it is written in English and interpolates this raw, so storing "вечерта"
// would put Cyrillic in the middle of an English instruction.
//
// Run: npm run test:time-options

import type { Language } from "./types";

/** Minutes between offered slots. Half-hourly, which is 48 entries: fine
 * granularity for a flight and a short enough list to scan. A finer step
 * would be a longer list to answer a question nobody asks about a flight
 * ("did you land at 20:15 or 20:20"). */
export const TIME_STEP_MINUTES = 30;

/** A time of day, for when a clock time is not known.
 *
 * `value` is what goes in the brief, in English. `bg` is display only, and
 * unlike the city list these ARE translated here, because they are ordinary
 * words rather than proper nouns - "вечерта" is not a transliteration
 * judgement the way a city name is.
 */
export interface TimeOfDayOption {
  value: string;
  bg: string;
}

export const TIMES_OF_DAY: TimeOfDayOption[] = [
  { value: "early morning", bg: "рано сутрин" },
  { value: "morning", bg: "сутрин" },
  { value: "midday", bg: "по обяд" },
  { value: "afternoon", bg: "следобед" },
  { value: "evening", bg: "вечерта" },
  { value: "late evening", bg: "късно вечерта" },
];

const LOCALE_BY_LANGUAGE: Record<Language, string> = { en: "en-GB", bg: "bg-BG" };

/** Whether a value is one of the clock slots' canonical form: HH:MM, 24-hour,
 * zero-padded. Deliberately strict, because this is the shape the prompt and
 * the engine's own hour arithmetic already expect. */
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: string): boolean {
  return CLOCK_RE.test(value);
}

/** Every offered clock slot, as canonical HH:MM. */
export function clockSlots(stepMinutes = TIME_STEP_MINUTES): string[] {
  const slots: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

/** How a clock time reads in this language.
 *
 * Through Intl rather than by hand, so en-GB stays 24-hour and a locale
 * that wants "8:00 pm" gets it - and so the format matches the calendar
 * beside it, which is already Intl-formatted (see SingleDatePicker). A
 * fixed UTC date carries the time because only the clock part is
 * formatted, and UTC keeps a DST boundary from shifting it.
 */
export function formatClockTime(value: string, language: Language): string {
  const match = CLOCK_RE.exec(value);
  if (!match) return value;
  const at = new Date(Date.UTC(2024, 0, 1, Number(match[1]), Number(match[2])));
  return new Intl.DateTimeFormat(LOCALE_BY_LANGUAGE[language], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(at);
}

/** What to show for whatever is currently in the field.
 *
 * Three cases, and the third is the one that matters: a clock slot formats
 * per locale, a known time of day uses its translation, and ANYTHING ELSE is
 * returned unchanged. That last case is what keeps a value typed before this
 * picker existed - or written by flight import - visible instead of being
 * silently blanked by a control that does not recognise it.
 */
export function formatTimeValue(value: string, language: Language): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isClockTime(trimmed)) return formatClockTime(trimmed, language);
  const timeOfDay = TIMES_OF_DAY.find((option) => option.value === trimmed.toLowerCase());
  if (timeOfDay) return language === "bg" ? timeOfDay.bg : timeOfDay.value;
  return trimmed;
}

/** Best effort at turning something typed into a canonical slot.
 *
 * Used when a value arrives from somewhere other than this picker - flight
 * import, a restored form, a deep link. Returns null when there is no single
 * unambiguous reading, because guessing a departure time wrong moves a whole
 * last day.
 */
export function normalizeTimeValue(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (isClockTime(raw)) return raw;

  const timeOfDay = TIMES_OF_DAY.find((option) => option.value === raw);
  if (timeOfDay) return timeOfDay.value;

  // "8pm", "8 pm", "8:30pm", "8.30 pm"
  const twelve = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/.exec(raw);
  if (twelve) {
    const hour12 = Number(twelve[1]);
    const minute = twelve[2] ? Number(twelve[2]) : 0;
    if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const hour = twelve[3] === "pm" ? (hour12 === 12 ? 12 : hour12 + 12) : hour12 === 12 ? 0 : hour12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  // "8:30", "08.30", "20:00" with a single-digit hour, and bare "20".
  const twentyFour = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(raw);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = twentyFour[2] ? Number(twentyFour[2]) : 0;
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return null;
}
