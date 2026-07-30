// Builds a downloadable .ics calendar from a generated itinerary — one
// event per line item. Zero new dependencies: the iCalendar format (RFC
// 5545) is plain text, so this is just careful string-building rather than
// a library. Uses each destination's local wall-clock time (floating, no
// timezone) since that's what a traveler actually means by "9am" on a
// trip — looking up each destination's real IANA timezone isn't worth the
// complexity for a first version of this.

import type { Itinerary, ItineraryItem } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcsDateTime(date: Date): string {
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function formatIcsUtc(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

/** Escapes text per RFC 5545 §3.3.11 — backslash first, then comma,
 * semicolon, and newline, in that order (escaping commas before the
 * backslash pass would double-escape the backslash just inserted). */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Folds a content line to <=75 octets per RFC 5545 §3.1 — some calendar
 * clients reject or mis-render unfolded long lines, which a DESCRIPTION
 * built from the model's reasoning text easily exceeds. */
function foldIcsLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;
  let result = line.slice(0, MAX);
  let rest = line.slice(MAX);
  while (rest.length > 0) {
    const chunk = rest.slice(0, MAX - 1);
    result += "\r\n " + chunk;
    rest = rest.slice(MAX - 1);
  }
  return result;
}

function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (hhmm) {
    return {
      hour: Math.min(23, Math.max(0, Number(hhmm[1]))),
      minute: Math.min(59, Math.max(0, Number(hhmm[2]))),
    };
  }
  const lower = time.trim().toLowerCase();
  if (lower === "morning") return { hour: 9, minute: 0 };
  if (lower === "afternoon") return { hour: 14, minute: 0 };
  if (lower === "evening") return { hour: 19, minute: 0 };
  return { hour: 12, minute: 0 }; // unrecognized format — midday is a safe, visible default
}

const EVENT_DURATION_MINUTES = 60;

const TIER_LABEL: Record<string, string> = {
  verified: "verified (2 sources agree)",
  fact_grounded: "grounded in a fact",
  single_source: "single source",
  conflicting: "sources disagree",
  inferred: "unverified guess",
};

function buildEvent(item: ItineraryItem, dayDate: string, uid: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayDate);
  if (!dateMatch) return null; // malformed date from the model — skip rather than emit a broken event
  const [, y, m, d] = dateMatch;
  const { hour, minute } = parseTimeOfDay(item.time);
  const start = new Date(Number(y), Number(m) - 1, Number(d), hour, minute, 0);
  const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60_000);

  const tierLabel = item.confidence_tier ? TIER_LABEL[item.confidence_tier] : undefined;
  const descriptionLines = [
    item.reasoning,
    `Estimated cost: €${item.cost_estimate_eur}`,
    tierLabel ? `Confidence: ${tierLabel}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return [
    "BEGIN:VEVENT",
    `UID:${uid}@decide`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsDateTime(start)}`,
    `DTEND:${formatIcsDateTime(end)}`,
    `SUMMARY:${escapeIcsText(item.title)}`,
    `DESCRIPTION:${escapeIcsText(descriptionLines.join("\n"))}`,
    `LOCATION:${escapeIcsText(item.location)}`,
    "END:VEVENT",
  ]
    .map(foldIcsLine)
    .join("\r\n");
}

/** One .ics per generated itinerary — no top-level "destinations" field on
 * Itinerary itself, so the calendar name is derived from the unique
 * locations actually used across items rather than requiring a separate
 * TripBriefInput to be threaded in just for this. */
export function buildItineraryIcs(itinerary: Itinerary, jobId: string): string {
  const events: string[] = [];
  for (const day of itinerary.days ?? []) {
    day.items.forEach((item, i) => {
      const event = buildEvent(item, day.date, `${jobId}-${day.day}-${i}`);
      if (event) events.push(event);
    });
  }

  const locations = Array.from(
    new Set((itinerary.days ?? []).flatMap((day) => day.items.map((item) => item.location).filter(Boolean)))
  ).slice(0, 5);
  const calName = locations.length ? locations.join(", ") : "decide itinerary";

  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//decide//Travel Itinerary//EN",
    "CALSCALE:GREGORIAN",
    foldIcsLine(`X-WR-CALNAME:${escapeIcsText(calName)}`),
  ].join("\r\n");

  return [header, ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
}

/** Triggers a browser download of the built .ics — a Blob + throwaway
 * anchor element, no server round-trip needed since everything required is
 * already in the client's own itinerary state. */
export function downloadItineraryIcs(itinerary: Itinerary, jobId: string): void {
  const ics = buildItineraryIcs(itinerary, jobId);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `decide-trip-${jobId}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
