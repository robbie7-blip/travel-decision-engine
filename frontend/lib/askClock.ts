// Today's date and time for Ask a Local, so "is my flight on time today"
// is about today. The model has no clock of its own and was guessing the
// date from its training (November 2026).
//
// The time zone is the traveller's own, sent by their browser; anything
// that is not a real IANA zone falls back to Sofia, where most of them are.
//
// Run: npm run test:ask-clock

export const FALLBACK_TIME_ZONE = "Europe/Sofia";

/** A time zone name the runtime knows, or the fallback. */
export function safeTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return value;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** One line for the prompt: the traveller's local date, weekday and time,
 * with UTC beside it so times from other zones can be worked out. */
export function nowLine(timeZone: string, now: Date = new Date()): string {
  const zone = safeTimeZone(timeZone);
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const utc = now.toISOString().slice(0, 16).replace("T", " ");
  return `\n\nRIGHT NOW: it is ${local} where the traveler is (${zone}), ${utc} UTC. "Today", "tonight" and "tomorrow" mean relative to this.`;
}
