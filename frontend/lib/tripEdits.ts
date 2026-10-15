// Changing a trip by hand: remove a line, move it to another day, change
// its time. No model involved, so it is instant and costs nothing - a
// pushback (a paid generation) is for changes that need new places, not
// for "lunch at 13:30 instead".
//
// Every edit names a line by where it sat in the ORIGINAL trip (day and
// position), and the whole batch is applied in one pass. Positions in a
// list being edited shift as lines leave it; positions in the original do
// not, so the order the edits were made in does not matter.
//
// Pure: the page uses it to show the draft and the server applies the
// same function to save it.
//
// Run: npm run test:trip-edits

import type { Itinerary, ItineraryItem } from "./types";

export interface TripEdit {
  /** The line, by its day and position in the trip being edited. */
  day: number;
  index: number;
  remove?: boolean;
  /** Another day of the same trip. */
  toDay?: number;
  /** "HH:MM", 24-hour. */
  time?: string;
}

export const MAX_TRIP_EDITS = 200;

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidEditTime(value: string): boolean {
  return TIME.test(value.trim());
}

/** "9:05" -> "09:05", so a typed time sorts and reads like the model's. */
function normaliseTime(value: string): string {
  const m = TIME.exec(value.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : value;
}

/** The model may write "morning" rather than a clock time (see the
 * schema in lib/engine/prompt.ts); those sort where they would fall. */
const PART_OF_DAY: Record<string, number> = { morning: 9 * 60, afternoon: 14 * 60, evening: 19 * 60 };

function minutes(time: unknown): number {
  const text = (typeof time === "string" ? time : "").trim().toLowerCase();
  const m = /^(\d{1,2}):(\d{2})/.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return PART_OF_DAY[text] ?? 24 * 60 + 1;
}

/** Edits from a request body, or a reason they are not usable. Strict:
 * anything unexpected is refused rather than half-applied. */
export function parseTripEdits(value: unknown): { ok: true; edits: TripEdit[] } | { ok: false; detail: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, detail: "edits must be a non-empty list." };
  if (value.length > MAX_TRIP_EDITS) return { ok: false, detail: `At most ${MAX_TRIP_EDITS} edits at a time.` };
  const edits: TripEdit[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { ok: false, detail: "Each edit must be an object." };
    const e = raw as Record<string, unknown>;
    if (!Number.isInteger(e.day) || !Number.isInteger(e.index)) return { ok: false, detail: "Each edit needs a day and an index." };
    const edit: TripEdit = { day: e.day as number, index: e.index as number };
    if (e.remove !== undefined) {
      if (typeof e.remove !== "boolean") return { ok: false, detail: "remove must be true or false." };
      if (e.remove) edit.remove = true;
    }
    if (e.toDay !== undefined) {
      if (!Number.isInteger(e.toDay)) return { ok: false, detail: "toDay must be a day number." };
      edit.toDay = e.toDay as number;
    }
    if (e.time !== undefined) {
      if (typeof e.time !== "string" || !isValidEditTime(e.time)) return { ok: false, detail: "time must look like 13:30." };
      edit.time = normaliseTime(e.time);
    }
    if (!edit.remove && edit.toDay === undefined && edit.time === undefined) {
      return { ok: false, detail: "An edit must change something." };
    }
    edits.push(edit);
  }
  return { ok: true, edits };
}

/** The trip with the edits applied, or why it cannot be. Null-free on
 * purpose: an edit that points at a line or a day the trip does not have
 * is a stale page, and saving part of what someone asked for would give
 * them a plan they did not make. */
export function applyTripEdits(
  base: Itinerary,
  edits: TripEdit[]
): { ok: true; itinerary: Itinerary; changed: number } | { ok: false; detail: string } {
  const days = base.days ?? [];
  const dayNumbers = new Set(days.map((d) => d.day));
  const byLine = new Map<string, TripEdit>();
  for (const edit of edits) {
    const day = days.find((d) => d.day === edit.day);
    if (!day || edit.index < 0 || edit.index >= (day.items ?? []).length) {
      return { ok: false, detail: "That line is no longer in this trip. Reload the page and try again." };
    }
    if (edit.toDay !== undefined && !dayNumbers.has(edit.toDay)) {
      return { ok: false, detail: "That day is not part of this trip." };
    }
    const key = `${edit.day}:${edit.index}`;
    if (byLine.has(key)) return { ok: false, detail: "The same line was edited twice." };
    byLine.set(key, edit);
  }

  const itinerary: Itinerary = JSON.parse(JSON.stringify(base));
  const target = new Map<number, ItineraryItem[]>(itinerary.days.map((d) => [d.day, []]));
  const touched = new Set<number>();
  let changed = 0;

  for (const day of itinerary.days) {
    (day.items ?? []).forEach((item, index) => {
      const edit = byLine.get(`${day.day}:${index}`);
      if (!edit) {
        target.get(day.day)!.push(item);
        return;
      }
      changed++;
      touched.add(day.day);
      if (edit.remove) return;
      const next: ItineraryItem = { ...item };
      if (edit.time !== undefined) next.time = edit.time;
      const toDay = edit.toDay ?? day.day;
      if (toDay !== day.day) {
        // Opening hours were checked for the date it was planned on, not
        // the one it moved to - so that claim no longer holds and is not
        // shown. Rating, link and photo are about the place and stay.
        delete next.google_open_on_visit;
      }
      touched.add(toDay);
      target.get(toDay)!.push(next);
    });
  }

  for (const day of itinerary.days) {
    const items = target.get(day.day)!;
    if (touched.has(day.day)) items.sort((a, b) => minutes(a.time) - minutes(b.time));
    day.items = items;
  }
  // The last pushback's answer was about the trip before these edits.
  delete itinerary.pushback_response;
  return { ok: true, itinerary, changed };
}
